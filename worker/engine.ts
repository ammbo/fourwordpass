import type { ProfileName } from "../shared/names";
// The bill lifecycle. Every state change goes through here.
//
// Sandbox/mock model (new live payments are gated pending the held-dollar design):
//  - A *pass* is $1 moving from the platform to a person (PayPal payout).
//  - A *hop* is four words written by whoever holds the bill.
//  - Words leave your hands one of two ways: a payout to the next person lands
//    (webhook or poll), or you release the bill into the wild (the platform holds
//    the dollar until someone claims it). Until then, they're pending.
//  - You hold the buck only once your dollar has landed.
//  - Don't want it? Send it back: it returns to whoever passed it to you (the creator,
//    for a first hand-off), and they pick someone else. Their words are already in.
//
// All transitions are conditional UPDATEs, so duplicate webhooks, racing polls
// and double-clicks are no-ops.

import { checkFinale, checkFourWords, isEmail, maskEmail, normalizeWords } from "../shared/words";
import { SERIAL_PREFIX } from "../shared/brand";
import { LIVE_PAYMENT_NOTICE } from "../shared/payments";
import type { FollowPreference } from "../shared/types";
import * as ai from "./ai";
import { OFFER_TTL, challengeLimit, createChallenge, penNameFor } from "./challenges";
import { type BillRow, type HopRow, type PassRow, getBill, getHop, getPass, personalityOf, storyTail, touch } from "./db";
import { queueMail, sendMail } from "./email";
import { DIRTY_MESSAGE, isClean } from "./moderation";
import { DELIVERED, FAILED, type PayoutState, captureOrder, createPayout, getPayout, isDuplicateBatch, isTransient, paypalMode } from "./paypal";
import { DAY, HOUR, type Place, appUrl, capToken, newId, now, participantId, placeLabel, recoveryHash, sleep } from "./util";

export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Ctx = { waitUntil(p: Promise<unknown>): void };

const lower = (s: string) => s.trim().toLowerCase();

function validateWords(words: string): string {
  const clean = normalizeWords(words);
  if (clean.length > 90) throw new UserError("Your four words are too long (90 characters max).");
  const check = checkFourWords(clean);
  if (!check.ok) throw new UserError(check.error!);
  if (!isClean(clean)) throw new UserError(DIRTY_MESSAGE);
  return clean;
}

function validateShort(text: string | null | undefined, max: number, label: string): string | null {
  const t = normalizeWords(text ?? "");
  if (!t) return null;
  if (t.length > max) throw new UserError(`${label} is too long (${max} characters max).`);
  if (!isClean(t)) throw new UserError(DIRTY_MESSAGE);
  return t;
}

export function validateEmail(email: string | null | undefined, label = "That email"): string {
  const e = lower(email ?? "");
  if (e.length > 254 || !isEmail(e)) throw new UserError(`${label} doesn't look right.`);
  return e;
}

/**
 * A claimed pen name signs only for its owner: the account whose email this hop's writer is.
 * Unclaimed pen names stay free text. A paid mint drops a taken name rather than failing.
 */
export async function signature(env: Env, penNameIn: string | null | undefined, writerEmail: string, onTaken: "throw" | "drop" = "throw") {
  const penName = validateShort(penNameIn, 24, "Your pen name");
  if (!penName) return { penName: null, verified: 0 };
  const owner = await env.DB.prepare("SELECT handle, pid FROM users WHERE handle = ? COLLATE NOCASE").bind(penName).first<{ handle: string; pid: string }>();
  if (!owner) return { penName, verified: 0 };
  if (owner.pid === (await participantId(env, writerEmail))) return { penName: owner.handle, verified: 1 };
  if (onTaken === "drop") return { penName: null, verified: 0 };
  throw new UserError("That pen name is claimed. Sign in as its owner, or pick another.");
}

const dayOf = (bill: BillRow, t: number) => Math.floor((t - bill.created_at) / DAY) + 1;
const hopPlace = (h: Pick<HopRow, "city" | "region" | "country">) => placeLabel(h);

const recountStmt = (env: Env, billId: string) =>
  env.DB.prepare(
    `UPDATE bills SET
       hop_count = (SELECT COUNT(*) FROM hops WHERE bill_id = ?1 AND status = 'confirmed'),
       word_count = (SELECT COALESCE(SUM(content_words), 0) FROM hops WHERE bill_id = ?1 AND status = 'confirmed'),
       version = version + 1
     WHERE id = ?1`,
  ).bind(billId);

/** Index is assigned here, at confirmation — failed payouts consume no index. */
const confirmHopStmt = (env: Env, hopId: string, billId: string, guard = "1", args: unknown[] = []) =>
  env.DB.prepare(
    `UPDATE hops SET status = 'confirmed', confirmed_at = ?1,
       idx = (SELECT COALESCE(MAX(idx), 0) + 1 FROM hops WHERE bill_id = ?2)
     WHERE id = ?3 AND status = 'pending' AND (${guard})`,
  ).bind(now(), billId, hopId, ...args);

async function addDiary(env: Env, bill: BillRow, kind: string, text: string, opts: { hopId?: string; place?: string; meta?: ai.AiMeta } = {}) {
  const t = now();
  await env.DB.prepare("INSERT OR IGNORE INTO diary (id, bill_id, hop_id, kind, day_label, text, ai_meta, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(kind === "hop" && opts.hopId ? `hop:${opts.hopId}` : kind === "goal" ? `goal:${bill.id}` : newId(), bill.id, opts.hopId ?? null, kind, `Day ${dayOf(bill, t)}${opts.place ? ` — ${opts.place}` : ""}`, text, opts.meta ? JSON.stringify(opts.meta) : null, t)
    .run();
}

// ====================================================================== mint / fork

export type MintInput = {
  /** Server-only: the signed-in creator's name, never taken from a request body. */
  inviterName?: string;
  firstName?: string; lastName?: string;
  orderId: string;
  recoveryKey: string;
  creatorEmail: string;
  words: string;
  theme?: string | null;
  goal?: number | null;
  firstRecipient?: string | null;   // null → release straight into the wild
  penName?: string | null;
  showCity?: boolean;
  fork?: { parentSerial: string; atHop: number };
  /** Set only by the server, for a signed-in admin: no checkout, the platform funds the first payout. */
  compedBy?: string;
  /** Make the pen name theirs: the creator-key email also carries a link that creates the account. */
  createAccount?: boolean;
};

export async function mintBill(env: Env, ctx: Ctx, place: Place, input: MintInput): Promise<{ serial: string; creatorToken: string }> {
  const creatorEmail = validateEmail(input.creatorEmail, "Your email");
  const words = validateWords(input.words);
  const theme = validateShort(input.theme, 140, "The theme");
  const signed = await signature(env, input.penName, creatorEmail, "drop");
  const creatorPid = await participantId(env, creatorEmail);
  const firstRecipient = input.firstRecipient ? validateEmail(input.firstRecipient, "Your recipient's email") : null;
  if (firstRecipient && firstRecipient === creatorEmail) throw new UserError("Send it to someone else. That's the whole game.");
  const goal = input.goal ? Math.floor(Number(input.goal)) : null;
  if (goal !== null && (!(goal >= 2) || goal > 100_000)) throw new UserError("Goals run from 2 to 100,000 hops.");

  let parent: BillRow | null = null;
  if (input.fork) {
    parent = await env.DB.prepare("SELECT * FROM bills WHERE serial = ?").bind(input.fork.parentSerial).first<BillRow>();
    if (!parent) throw new UserError("That bill doesn't exist.", 404);
    const max = await env.DB.prepare("SELECT MAX(idx) AS m FROM hops WHERE bill_id = ? AND status = 'confirmed'").bind(parent.id).first<{ m: number | null }>();
    if (!(input.fork.atHop >= 1 && input.fork.atHop <= (max?.m ?? 0))) throw new UserError("Pick a hop to fork from.");
  }

  if (!input.recoveryKey || input.recoveryKey.length < 32 || input.recoveryKey.length > 128) throw new UserError("This checkout needs a recovery key. Refresh before paying.");
  const hash = await recoveryHash(input.recoveryKey);
  if (input.compedBy) {
    // No checkout to verify, but the first payout still has to be possible.
    if (paypalMode(env) === "live") throw new UserError(LIVE_PAYMENT_NOTICE, 503);
  } else {
    const checkout = await env.DB.prepare("SELECT recovery_hash,purpose,paypal_mode FROM checkout_orders WHERE order_id = ?").bind(input.orderId)
      .first<{recovery_hash: string; purpose: string; paypal_mode: string}>();
    if (!checkout || checkout.recovery_hash !== hash || checkout.purpose !== (parent ? "fork" : "mint") || checkout.paypal_mode !== paypalMode(env)) throw new UserError("Use the private recovery key from the original checkout.",403);
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO mint_attempts (order_id,recovery_hash,input_json,place_json,bill_id,paypal_mode,created_at)
    VALUES (?,?,?,?,?,?,?)`).bind(input.orderId, hash, JSON.stringify(input), JSON.stringify(place), newId(), paypalMode(env), now()).run();
  const attempt = (await env.DB.prepare("SELECT * FROM mint_attempts WHERE order_id = ?").bind(input.orderId)
    .first<{recovery_hash: string; input_json: string; place_json: string; bill_id: string; paypal_mode: string}>())!;
  if (attempt.recovery_hash !== hash) throw new UserError("That payment belongs to another checkout attempt.", 403);
  if (attempt.paypal_mode !== paypalMode(env)) throw new UserError("This checkout belongs to a different payment environment.", 409);
  // A retry uses the exact paid draft, not subsequently edited fields.
  if (attempt.input_json !== JSON.stringify(input)) return mintBill(env, ctx, JSON.parse(attempt.place_json) as Place, JSON.parse(attempt.input_json) as MintInput);
  const billId = attempt.bill_id;
  let bill = await getBill(env, billId);
  if (!bill) {
    if (!input.compedBy) {
      const used = await env.DB.prepare("SELECT 1 FROM bills WHERE checkout_order_id = ?").bind(input.orderId).first();
      if (used) throw new UserError("That payment already minted a bill. Use the original creator email.", 409);
      try { await captureOrder(env, input.orderId); }
      catch (e) { throw new UserError(`Checkout didn't go through: ${(e as Error).message}`, 402); }
    }

    const t = now();
    const origin = input.showCity === false ? null : place;
    // All persisted initialization commits together. A captured order can resume with its recovery key.
    for (let retry = 0; ; retry++) {
      const next = (await env.DB.prepare("SELECT COALESCE(MAX(seq),0)+1 AS n FROM bills").first<{n: number}>())!.n;
      const serial = `${SERIAL_PREFIX}-${String(next).padStart(4, "0")}`;
      const pers = await ai.makePersonality(env, {
        theme: theme ?? parent?.theme ?? null, origin: origin ? placeLabel(origin) : "an undisclosed location", serial,
        parentName: parent ? `${parent.serial} (${personalityOf(parent).name})` : undefined, openingWords: words,
      });
      // A comped bill has no checkout, so Open Books lists it as $0 in rather than a $2 sale.
      const stmts = [env.DB.prepare(`INSERT INTO bills (id,seq,serial,status,theme,goal_hops,creator_email,creator_pid,origin_city,origin_lat,origin_lng,
        forked_from_bill_id,forked_at_hop,checkout_order_id,checkout_mode,comped_by,created_at,personality)
        VALUES (?,?,?,'in_transit',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(billId,next,serial,theme ?? parent?.theme ?? null,goal,creatorEmail,creatorPid,origin ? placeLabel(origin) : null,
          origin?.lat ?? null,origin?.lng ?? null,parent?.id ?? null,input.fork?.atHop ?? null,
          input.compedBy ? null : input.orderId,input.compedBy ? null : attempt.paypal_mode,input.compedBy ?? null,t,JSON.stringify(pers.personality))];
      if (parent && input.fork) stmts.push(env.DB.prepare(`INSERT INTO hops (id,bill_id,idx,status,words,content_words,note,pen_name,pen_verified,city,region,country,lat,lng,
        inherited_from_hop_id,stamp_key,stamp_status,diary_done,followers_notified,created_at,confirmed_at)
        SELECT lower(hex(randomblob(16))),?1,idx,'confirmed',words,content_words,note,pen_name,pen_verified,city,region,country,lat,lng,
        COALESCE(inherited_from_hop_id,id),stamp_key,CASE WHEN stamp_status='ready' THEN 'ready' ELSE 'none' END,1,1,created_at,confirmed_at
        FROM hops WHERE bill_id=?2 AND status='confirmed' AND idx<=?3`).bind(billId,parent.id,input.fork.atHop));
      stmts.push(
        env.DB.prepare(`INSERT INTO hops (id,bill_id,status,words,content_words,pen_name,pen_verified,city,region,country,lat,lng,writer_email,writer_pid,created_at)
          VALUES (?,?,'pending',?,4,?,?,?,?,?,?,?,?,?,?)`).bind(`opening:${billId}`,billId,words,signed.penName,signed.verified,origin?.city ?? null,origin?.region ?? null,
            origin?.country ?? null,origin?.lat ?? null,origin?.lng ?? null,creatorEmail,creatorPid,t),
        env.DB.prepare("INSERT INTO follows (id,bill_id,email,pid,preference,created_at) VALUES (?,?,?,?,'every_hop',?)").bind(`creator:${billId}`,billId,creatorEmail,creatorPid,t),
        env.DB.prepare("UPDATE bills SET follower_count = 1 WHERE id = ?").bind(billId), recountStmt(env,billId),
        env.DB.prepare("INSERT INTO diary (id,bill_id,kind,day_label,text,ai_meta,created_at) VALUES (?,?,'birth','Day 1',?,?,?)")
          .bind(newId(),billId,pers.birthEntry,JSON.stringify(pers.meta),t),
      );
      try { await env.DB.batch(stmts); break; }
      catch (e) {
        if (await getBill(env,billId)) break; // Concurrent authorized retry completed it.
        if (retry >= 3 || !String(e).includes("UNIQUE")) throw e;
      }
    }
    bill = (await getBill(env,billId))!;
  }
  const hopId = `opening:${billId}`;
  const followId = `creator:${billId}`;
  const pers = {personality: personalityOf(bill)};
  const creatorToken = await capToken(env, "creator", billId);
  const share = appUrl(env, `/b/${bill.serial}`);
  // A paid release never fails over its account offer; a pen name that can't be claimed just isn't offered.
  const wanted = input.createAccount && !signed.verified && input.penName ? await penNameFor(env, input.penName, creatorEmail) : null;
  const offer = wanted && "name" in wanted && !(await challengeLimit(env, creatorEmail, false))
    ? { handle: wanted.name, ...(await createChallenge(env, creatorEmail, { firstName: input.firstName, lastName: input.lastName, id: `offer:${billId}`, handle: wanted.name, next: `/b/${bill.serial}`, ttl: OFFER_TTL })) }
    : null;
  // Queue the creator key before returning success, even if immediate delivery is interrupted.
  await queueMail(env, {
      deliveryKey: `creator:${billId}`,
      to: creatorEmail,
      kind: "creator",
      billId,
      serial: bill.serial,
      subject: "Your story is out in the world (keep this email)",
      preheader: "The button in this email is your key to writing the ending. Keep it somewhere safe.",
      heading: `I'm ${pers.personality.name}.`,
      paragraphs: [
        `${pers.personality.tagline.replace(/([^.!?…])$/, "$1.")} Thanks for printing me. I'm ${bill.serial}. Open my page to see where I am now.`,
        "You're following every hop. When the story's ready to end, you write the finale. Keep this email: the button below is your key.",
        `Share my page: ${share}`,
      ],
      quote: words,
      quoteLabel: "Your foreword",
      button: { label: "End the story (when it's time)", url: appUrl(env, `/b/${bill.serial}?c=${creatorToken}`) },
      unsubscribeUrl: appUrl(env, `/f/${followId}?t=${await capToken(env, "follow", followId)}`),
      ...(offer && {
        secondary: { label: `Finish my account as ${offer.handle}`, url: offer.url },
        footer: `You asked to make “${offer.handle}” your pen name. The link above proves this address and creates your account; it works once, for 7 days.`,
      }),
    });
  try {
    if (bill.status === "in_transit" && !bill.active_pass_id && firstRecipient) {
      // A rejected first address sends the paid story wild; the creator still gets their key.
      await startPass(env, ctx, bill, { kind: parent ? "fork" : "mint", email: firstRecipient, fromHopId: hopId, senderPassId: null, senderName: input.inviterName }, false);
    } else if (bill.status === "in_transit" && !bill.active_pass_id) {
      await releaseToWild(env, ctx, bill, hopId, null);
    }
  } catch (e) {
    const current = await getBill(env,billId);
    if (!current || (current.status === "in_transit" && !current.active_pass_id)) throw e;
    // A concurrent authorized retry already reserved or completed this same mint.
  }

  return { serial: bill.serial, creatorToken };
}

// ====================================================================== passes (money)

// Per-inbox ceilings, so nobody can point the game at someone's address and flood it.
const PASSES_PER_RECIPIENT_PER_DAY = 5;
const FOLLOW_CONFIRMS_PER_RECIPIENT_PER_DAY = 3;
const HOP_MAIL_GAP = 3 * HOUR;
const RESEND_GAP = HOUR;

/** A slow payout remains reserved until PayPal supplies a definitive outcome. */
const PASS_TIMEOUT = 2 * HOUR;
export const TIMED_OUT = "PayPal didn't confirm this payout in time.";

async function startPass(
  env: Env,
  ctx: Ctx,
  bill: BillRow,
  p: { kind: PassRow["kind"]; email: string; fromHopId: string | null; senderPassId: string | null; senderName?: string },
  throwOnFailure = true,
): Promise<PassRow> {
  const passId = newId();
  const t = now();
  const mode = paypalMode(env);
  if (mode === "live") throw new UserError(LIVE_PAYMENT_NOTICE, 503);
  const pid = await participantId(env, p.email);
  if (p.kind === "pass" || p.kind === "claim") {
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM passes WHERE recipient_pid = ? AND kind IN ('pass','claim') AND created_at > ?")
      .bind(pid, t - DAY).first<{ n: number }>();
    if ((recent?.n ?? 0) >= PASSES_PER_RECIPIENT_PER_DAY) {
      if (p.fromHopId) await env.DB.prepare("UPDATE hops SET status = 'void' WHERE id = ? AND status = 'pending'").bind(p.fromHopId).run();
      throw new UserError(p.kind === "claim"
        ? "That address has claimed plenty of bucks today. Try again tomorrow."
        : "That person has been passed plenty of bucks today. Pick someone else, or release it to the wild.", 429);
    }
  }
  // Holder/creator capabilities authorize a repass. A first handoff must use the
  // signed-in creator's server-supplied name, not a lookup of an unproven typed email.
  let senderName = p.senderName ?? null;
  if (p.kind === "pass") {
    const keeper = p.senderPassId ? await getPass(env, p.senderPassId) : null;
    const email = keeper?.recipient_email ?? bill.creator_email;
    const sender = email ? await env.DB.prepare("SELECT first_name,last_name FROM users WHERE email = ?")
      .bind(email).first<{ first_name: string | null; last_name: string | null }>() : null;
    senderName = sender?.first_name ? [sender.first_name, sender.last_name].filter(Boolean).join(" ") : null;
  }
  // D1 batch is a transaction: either both reservation and pass exist, or neither does.
  const reserved = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO passes (id, bill_id, kind, recipient_email, recipient_pid, from_hop_id, sender_pass_id, status, paypal_mode, next_poll_at, created_at, sender_name)
       SELECT ?,?,?,?,?,?,?,'pending',?,?,?,? WHERE EXISTS
       (SELECT 1 FROM bills WHERE id = ? AND status = ? AND version = ? AND active_pass_id IS NULL)`,
    ).bind(passId, bill.id, p.kind, p.email, pid, p.fromHopId, p.senderPassId, mode, t + 3000, t, senderName, bill.id, bill.status, bill.version),
    env.DB.prepare(`UPDATE bills SET status = 'in_transit', active_pass_id = ?, version = version + 1
       WHERE id = ? AND EXISTS (SELECT 1 FROM passes WHERE id = ?)`)
      .bind(passId, bill.id, passId),
  ]);
  if (!reserved[0].meta.changes) {
    if (p.fromHopId) await env.DB.prepare("UPDATE hops SET status = 'void' WHERE id = ? AND status = 'pending'").bind(p.fromHopId).run();
    throw new UserError("This buck has moved on.", 409);
  }
  const pass = (await getPass(env, passId))!;
  try {
    await sendPayout(env, bill, pass);
  } catch (e) {
    if (!isTransient(e) && !isDuplicateBatch(e)) {
      await failPass(env, ctx, pass, { status: "FAILED", itemId: null, transactionId: null, error: (e as Error).message });
      if (throwOnFailure) throw new UserError(`PayPal couldn't send to that address: ${(e as Error).message}`);
      return (await getPass(env, passId))!;
    }
    // A PayPal hiccup isn't the recipient's fault. The pass stays in flight and gets retried.
    await env.DB.prepare("UPDATE passes SET error = ? WHERE id = ?").bind((e as Error).message, passId).run();
  }
  ctx.waitUntil(quickPoll(env, ctx, passId));
  return (await getPass(env, passId))!;
}

/** Safe to repeat: the pass id is the sender_batch_id, and PayPal won't accept a second batch with it. */
async function sendPayout(env: Env, bill: BillRow, pass: PassRow) {
  if (pass.paypal_mode !== paypalMode(env)) throw new Error("This payout belongs to a different PayPal environment. Restore its credentials to reconcile it.");
  const n = bill.hop_count + (pass.from_hop_id ? 1 : 0);
  const url = appUrl(env, `/b/${bill.serial}`).replace(/^https?:\/\//, "");
  const { batchId } = await createPayout(env, {
    passId: pass.id,
    email: pass.recipient_email,
    since: pass.created_at,
    subject: `${bill.serial} is yours`,
    message: `A dollar with a story just landed. Add your four words and pass it on: ${url}`,
    note: `${bill.serial} is yours. ${n} ${n === 1 ? "stranger is" : "strangers are"} writing its story.\nAdd your 4 words: ${url}`,
  });
  await env.DB.prepare("UPDATE passes SET payout_batch_id = ?, paypal_status = 'PENDING', error = NULL WHERE id = ? AND status = 'pending'")
    .bind(batchId, pass.id)
    .run();
}

/** Sandbox payouts usually settle in seconds. Poll right away so the handoff feels live, and retry a hiccup quickly. */
async function quickPoll(env: Env, ctx: Ctx, passId: string) {
  for (const wait of [3000, 3000, 4000, 6000, 8000]) {
    await sleep(wait);
    const pass = await getPass(env, passId);
    if (!pass || pass.status !== "pending") return;
    await advancePass(env, ctx, pass).catch((e) => console.error("poll failed", e));
  }
}

/** Retry or poll the same payout. A timeout flags the delay without releasing its reservation. */
export async function advancePass(env: Env, ctx: Ctx, pass: PassRow) {
  if (pass.paypal_mode !== paypalMode(env)) return;
  const backoff = pass.status === "delivered" ? 6 * HOUR : Math.min(15 * 60_000, 30_000 * 2 ** Math.min(10, Math.max(0, pass.poll_count - 4)));
  await env.DB.prepare("UPDATE passes SET poll_count = poll_count + 1, next_poll_at = ? WHERE id = ?").bind(now() + backoff, pass.id).run();
  try {
    if (pass.payout_batch_id) await applyPayoutState(env, ctx, pass, await getPayout(env, pass.payout_batch_id));
    else await sendPayout(env, (await getBill(env, pass.bill_id))!, pass);
  } catch (e) {
    // A failed poll, or a retry that hit another hiccup, tries again later. A duplicate batch
    // means an earlier attempt reached PayPal after all, and its webhook will settle the pass.
    if (!pass.payout_batch_id && !isTransient(e) && !isDuplicateBatch(e)) {
      return failPass(env, ctx, pass, { status: "FAILED", itemId: null, transactionId: null, error: (e as Error).message });
    }
    await env.DB.prepare("UPDATE passes SET error = ? WHERE id = ? AND status = 'pending'").bind((e as Error).message, pass.id).run();
  }
  if (now() - pass.created_at > PASS_TIMEOUT) {
    const latest = await getPass(env, pass.id);
    if (latest?.status === "pending") {
      await env.DB.prepare("UPDATE passes SET error = ? WHERE id = ? AND status = 'pending'").bind(TIMED_OUT, pass.id).run();
    }
  }
}

export async function applyPayoutState(env: Env, ctx: Ctx, snapshot: PassRow, state: PayoutState) {
  const pass = await getPass(env, snapshot.id);
  if (!pass) return;
  if (state.status === pass.paypal_status && (!state.itemId || state.itemId === pass.payout_item_id)
      && (!state.transactionId || state.transactionId === pass.transaction_id)) {
    const bill = await getBill(env,pass.bill_id);
    if (bill?.active_pass_id !== pass.id) return;
  }
  if (["RETURNED", "REFUNDED", "REVERSED"].includes(pass.paypal_status ?? "") && state.status === "SUCCESS") return;
  // A verified later financial outcome updates the ledger without rewinding the story.
  // Ignore stale pending/unclaimed events after a more definitive outcome.
  if (pass.paypal_status === "SUCCESS" && state.status !== "SUCCESS" && !FAILED.has(state.status)) return;
  if (FAILED.has(pass.paypal_status ?? "") && state.status !== pass.paypal_status && !["SUCCESS", "RETURNED", "REFUNDED", "REVERSED"].includes(state.status)) return;
  if (DELIVERED.has(state.status)) return deliverPass(env, ctx, pass, state);
  if (FAILED.has(state.status)) return failPass(env, ctx, pass, state);
  if (pass.status === "pending" && state.status !== pass.paypal_status) {
    await env.DB.batch([
      env.DB.prepare("UPDATE passes SET paypal_status = ?, payout_item_id = COALESCE(?, payout_item_id) WHERE id = ? AND status = 'pending'").bind(state.status, state.itemId, pass.id),
      touch(env, pass.bill_id),
    ]);
  }
}

async function deliverPass(env: Env, ctx: Ctx, pass: PassRow, state: PayoutState) {
  const t = now();
  const stmts = [env.DB.prepare(
    `UPDATE passes SET status = 'delivered', paypal_status = ?, payout_item_id = COALESCE(?, payout_item_id),
       transaction_id = COALESCE(?, transaction_id), error = NULL, settled_at = COALESCE(settled_at, ?) WHERE id = ?
       AND COALESCE(paypal_status, '') NOT IN ('RETURNED','REFUNDED','REVERSED')
       AND (? = 'SUCCESS' OR COALESCE(paypal_status, '') NOT IN ('SUCCESS','FAILED','BLOCKED','DENIED','CANCELED'))`,
  ).bind(state.status, state.itemId, state.transactionId, t, pass.id, state.status)];
  if (pass.from_hop_id) stmts.push(confirmHopStmt(env, pass.from_hop_id, pass.bill_id,
    "EXISTS (SELECT 1 FROM bills b JOIN passes p ON p.id = b.active_pass_id WHERE b.id = ?4 AND b.status = 'in_transit' AND p.id = ?5 AND p.status = 'delivered')", [pass.bill_id, pass.id]));
  stmts.push(
    env.DB.prepare(`UPDATE bills SET status = 'holding', holder_pass_id = ?, holder_since = ?, held_via_wild = ?,
       wild_since = NULL, nag_level = 0, returned_pass_id = NULL, active_pass_id = NULL
       WHERE id = ? AND status = 'in_transit' AND active_pass_id = ?
         AND EXISTS (SELECT 1 FROM passes WHERE id = bills.active_pass_id AND status = 'delivered')`)
      .bind(pass.id, t, pass.kind === "claim" ? 1 : 0, pass.bill_id, pass.id),
    recountStmt(env, pass.bill_id),
  );
  await env.DB.batch(stmts);
  ctx.waitUntil(afterDelivery(env, pass.id));
}

async function failPass(env: Env, ctx: Ctx, pass: PassRow, state: PayoutState) {
  const t = now();
  const bill = (await getBill(env, pass.bill_id))!;
  const stmts = [env.DB.prepare(
    `UPDATE passes SET status = 'failed', paypal_status = ?, payout_item_id = COALESCE(?, payout_item_id),
      transaction_id = COALESCE(?, transaction_id), error = ?, settled_at = COALESCE(settled_at, ?) WHERE id = ?
      AND (COALESCE(paypal_status, '') NOT IN ('RETURNED','REFUNDED','REVERSED') OR ? IN ('RETURNED','REFUNDED','REVERSED'))`,
  ).bind(state.status, state.itemId, state.transactionId, state.error ?? state.status, t, pass.id, state.status)];
  if (pass.kind === "pass") {
    stmts.push(env.DB.prepare(`UPDATE hops SET status = 'void' WHERE id = ? AND status = 'pending' AND EXISTS
      (SELECT 1 FROM bills b JOIN passes p ON p.id = b.active_pass_id WHERE b.id = ? AND p.id = ? AND p.status = 'failed')`)
      .bind(pass.from_hop_id, bill.id, pass.id));
  } else if (pass.from_hop_id) {
    stmts.push(confirmHopStmt(env, pass.from_hop_id, bill.id,
      "EXISTS (SELECT 1 FROM bills b JOIN passes p ON p.id = b.active_pass_id WHERE b.id = ?4 AND p.id = ?5 AND p.status = 'failed')", [bill.id, pass.id]));
  }
  stmts.push(env.DB.prepare(`UPDATE bills SET status = ?, active_pass_id = NULL,
     wild_since = CASE WHEN ? = 'wild' THEN ? ELSE wild_since END
     WHERE id = ? AND status = 'in_transit' AND active_pass_id = ?
       AND EXISTS (SELECT 1 FROM passes WHERE id = bills.active_pass_id AND status = 'failed')`)
     .bind(pass.kind === "pass" ? "holding" : "wild", pass.kind === "pass" ? "holding" : "wild", t, bill.id, pass.id), recountStmt(env, bill.id));
  const result = await env.DB.batch(stmts);
  if (!result[stmts.length - 2].meta.changes) return; // Financial corrections must not move a story that has already moved on.

  if (pass.kind === "pass") {
    const keeper = await keeperOf(env, bill);
    if (keeper) {
      const who = maskEmail(pass.recipient_email);
      const timedOut = state.error === TIMED_OUT;
      ctx.waitUntil(
        sendMail(env, {
          to: keeper.email,
          kind: "pass_failed",
          billId: bill.id,
          serial: bill.serial,
          subject: `${personalityOf(bill).name} couldn't reach ${who}`,
          heading: "Still in your pocket.",
          paragraphs: [
            `${timedOut ? `PayPal never confirmed the payout to ${who}` : `PayPal couldn't deliver me to ${who}`}, so ${pass.from_hop_id ? "your words are on hold" : "I'm still with you"}. ${timedOut ? "Try them again, pick" : "Pick"} someone else, or release me into the wild.`,
          ],
          button: { label: "Pass me to someone else", url: keeper.url },
        }),
      );
    }
  } else if (pass.kind !== "claim") {
    // The opening is confirmed in the same transaction as the failed handoff.
    if (pass.from_hop_id) ctx.waitUntil(runHopEffects(env, pass.from_hop_id));
    if (bill.creator_email) {
      ctx.waitUntil(
        sendMail(env, {
          to: bill.creator_email,
          kind: "mint_failed",
          billId: bill.id,
          serial: bill.serial,
          subject: `${personalityOf(bill).name} couldn't reach ${maskEmail(pass.recipient_email)}, so it went wild`,
          heading: "Change of plans.",
          paragraphs: [
            `PayPal couldn't deliver me to ${maskEmail(pass.recipient_email)}. Rather than sit around, I released myself into the wild. The first stranger to claim me picks up the story.`,
          ],
          button: { label: "See me in the wild", url: appUrl(env, `/b/${bill.serial}`) },
        }),
      );
    }
  }
}

async function releaseToWild(env: Env, ctx: Ctx, bill: BillRow, hopId: string | null, holderPassId: string | null, fromStatus: "holding" | "in_transit" = "in_transit") {
  const t = now();
  const guard = "EXISTS (SELECT 1 FROM bills WHERE id = ?4 AND status = ?5 AND holder_pass_id IS ?6 AND version = ?7)";
  const stmts = [];
  if (hopId) stmts.push(confirmHopStmt(env, hopId, bill.id, guard, [bill.id, fromStatus, holderPassId, bill.version]));
  const updateIndex = stmts.length;
  stmts.push(env.DB.prepare(`UPDATE bills SET status = 'wild', wild_since = ?, holder_pass_id = NULL, holder_since = NULL,
       held_via_wild = 0, nag_level = 0, returned_pass_id = NULL, active_pass_id = NULL, version = version + 1,
       hop_count = (SELECT COUNT(*) FROM hops WHERE bill_id = bills.id AND status = 'confirmed'),
       word_count = (SELECT COALESCE(SUM(content_words),0) FROM hops WHERE bill_id = bills.id AND status = 'confirmed')
       WHERE id = ? AND status = ? AND holder_pass_id IS ? AND version = ?`)
       .bind(t, bill.id, fromStatus, holderPassId, bill.version));
  const results = await env.DB.batch(stmts);
  if (!results[updateIndex].meta.changes) {
    if (hopId) await env.DB.prepare("UPDATE hops SET status = 'void' WHERE id = ? AND status = 'pending'").bind(hopId).run();
    throw new UserError("This buck has moved on.", 409);
  }
  if (hopId) ctx.waitUntil(runHopEffects(env, hopId));
}

// ====================================================================== after a hop lands

/** Idempotent; also re-run by cron for anything waitUntil didn't finish. */
export async function afterDelivery(env: Env, passId: string) {
  const pass = await getPass(env, passId);
  if (!pass || pass.status !== "delivered") return;
  if (!pass.holder_notified) {
    if (await emailHolder(env, pass)) await env.DB.prepare("UPDATE passes SET holder_notified = 1 WHERE id = ?").bind(passId).run();
  }
  if (pass.from_hop_id) await runHopEffects(env, pass.from_hop_id);
}

async function emailHolder(env: Env, pass: PassRow, resend = false) {
  const bill = (await getBill(env, pass.bill_id))!;
  if (bill.holder_pass_id !== pass.id || bill.status !== "holding") return true;
  const pers = personalityOf(bill);
  const tail = await storyTail(env, bill.id, 30);
  const places = await env.DB.prepare("SELECT COUNT(DISTINCT city) AS n FROM hops WHERE bill_id = ? AND status = 'confirmed' AND city IS NOT NULL").bind(bill.id).first<{ n: number }>();
  const n = bill.hop_count;
  const url = appUrl(env, `/b/${bill.serial}?t=${await capToken(env, "holder", pass.id)}`);
  // A claimer chose this bill on the site. Anyone else was named by the last holder and may never have heard of us.
  const claimed = pass.kind === "claim";
  const hop = !claimed && pass.from_hop_id ? await getHop(env, pass.from_hop_id) : null;
  const signedAs = hop?.pen_name;
  const senderName = claimed ? null : pass.sender_name;
  const money =
    pass.paypal_mode === "sandbox"
      ? "A $1 PayPal sandbox payout came with me. It's test money, so PayPal won't email you about it: this email is your way in."
      : pass.paypal_mode === "mock"
        ? "A simulated $1 payout came with me."
        : "PayPal just sent you $1.00. That's me.";
  return sendMail(env, {
    deliveryKey: `${resend ? "resend" : "holder"}:${pass.id}${resend ? `:${Math.floor(now() / RESEND_GAP)}` : ""}`,
    to: pass.recipient_email,
    kind: resend ? "holder_resend" : "holder",
    billId: bill.id,
    serial: bill.serial,
    senderName: senderName ?? undefined,
    subject: claimed ? `You claimed ${pers.name}. Add your four words.` : senderName ? `${senderName} invited you to a story on Four Word Pass` : "Someone passed you a story. Add four words.",
    preheader: claimed
      ? "You have 24 hours to add four words before it wanders back to the wild."
      : `${senderName ? `${senderName} passed you a story. ` : ""}Add four words, then pass it on. About a minute, no account.`,
    image: claimed ? undefined : "share-card",
    heading: claimed ? `${bill.serial} is yours.` : "You've been passed the buck.",
    paragraphs: [
      ...(claimed
        ? []
        : [`${senderName ?? "Someone"} passed you a buck on Four Word Pass: a dollar that carries a story, written four words at a time by whoever holds it.${signedAs ? ` They signed their words “${signedAs}.”` : ""}`]),
      `I'm ${pers.name}, the buck. ${n <= 1 ? "My story has only just started" : `${n} strangers have written my story so far${places?.n ? `, across ${places.n} ${places.n === 1 ? "place" : "places"}` : ""}`}. Now it's your turn: add exactly four words, then pass me on.`,
      `${money} No account or app needed; it takes about a minute.`,
    ],
    quote: tail || undefined,
    quoteLabel: tail ? "The story so far" : undefined,
    button: { label: "Add your 4 words", url },
    secondary: { label: claimed ? "Changed your mind? Put me back in the wild" : "Not for you? Send me back", url: `${url}&decline=1` },
    footer: claimed
      ? "You claimed me from the wild. You have 24 hours before I wander back out."
      : "Not your thing? Send me back, and whoever passed me to you will pick someone else. If you just sit on me, I get needy.",
  });
}

/** Whoever can move a bill that's sitting still: its holder, or its creator when it came back to them. */
async function keeperOf(env: Env, bill: BillRow): Promise<{ email: string; url: string } | null> {
  if (bill.holder_pass_id) {
    const pass = await getPass(env, bill.holder_pass_id);
    return pass && { email: pass.recipient_email, url: appUrl(env, `/b/${bill.serial}?t=${await capToken(env, "holder", pass.id)}`) };
  }
  if (bill.returned_pass_id && bill.creator_email) {
    return { email: bill.creator_email, url: appUrl(env, `/b/${bill.serial}?c=${await capToken(env, "creator", bill.id)}`) };
  }
  return null;
}

export async function resendHolderLink(env: Env, bill: BillRow) {
  if (bill.status !== "holding" || !bill.holder_pass_id) return;
  const pass = await getPass(env, bill.holder_pass_id);
  if (!pass) return;
  const allowed = await env.DB.prepare("UPDATE passes SET resend_at = ? WHERE id = ? AND (resend_at IS NULL OR resend_at < ?)")
    .bind(now(), pass.id, now() - RESEND_GAP).run();
  if (allowed.meta.changes) await emailHolder(env, pass, true);
}

export async function runHopEffects(env: Env, hopId: string) {
  let hop = await getHop(env, hopId);
  if (!hop || hop.status !== "confirmed" || hop.inherited_from_hop_id) return;
  const leased = await env.DB.prepare("UPDATE hops SET fx_lease_until = ? WHERE id = ? AND fx_lease_until < ?")
    .bind(now() + 300_000, hopId, now()).run();
  if (!leased.meta.changes) return;
  try {
    const bill = (await getBill(env, hop.bill_id))!;
    const pers = personalityOf(bill);
    const place = hopPlace(hop);
    let motif = `${place} street scene`;
    let diaryLine: string | null = null;

    if (!hop.diary_done) {
      const tail = await storyTail(env, bill.id, 60);
      const d = await ai.writeDiary(env, {
        pers, serial: bill.serial, words: hop.words, note: hop.note, place, hopNumber: hop.idx ?? bill.hop_count,
        day: dayOf(bill, hop.confirmed_at ?? now()), storyTail: tail, goal: bill.goal_hops, penName: hop.pen_name,
      });
      motif = d.motif;
      diaryLine = d.entry;
      await addDiary(env, bill, "hop", d.entry, { hopId, place, meta: d.meta });
      await env.DB.prepare("UPDATE hops SET diary_done = 1 WHERE id = ?").bind(hopId).run();
      await touch(env, bill.id).run();
    }

    if (!hop.followers_notified) {
      await notifyFollowers(env, bill, "hop", { hop, diaryLine });
      await env.DB.prepare("UPDATE hops SET followers_notified = 1 WHERE id = ?").bind(hopId).run();
    }

    if (bill.goal_hops && bill.hop_count >= bill.goal_hops && !bill.goal_notified) {
      await goalReached(env, bill);
      await env.DB.prepare("UPDATE bills SET goal_notified = 1 WHERE id = ?").bind(bill.id).run();
    }

    hop = (await getHop(env, hopId))!;
    if (hop.stamp_status === "pending") await paintHopStamp(env, hop, motif);
  } finally {
    await env.DB.prepare("UPDATE hops SET fx_lease_until = 0 WHERE id = ?").bind(hopId).run();
  }
}

export async function paintHopStamp(env: Env, hop: HopRow, motif: string) {
  try {
    // Image filters occasionally flag innocent motifs; fall back to the place itself.
    const bytes = await ai.paintStamp(env, motif).catch(() => ai.paintStamp(env, `a landmark of ${hopPlace(hop)}`));
    const key = `stamps/${hop.id}.jpg`;
    await env.STAMPS.put(key, bytes, { httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" } });
    await env.DB.batch([
      env.DB.prepare("UPDATE hops SET stamp_key = ?, stamp_status = 'ready' WHERE id = ?").bind(key, hop.id),
      touch(env, hop.bill_id),
    ]);
  } catch (e) {
    console.error("stamp failed", e);
    await env.DB.prepare("UPDATE hops SET fx_attempts = fx_attempts + 1, stamp_status = CASE WHEN fx_attempts >= 2 THEN 'failed' ELSE 'pending' END WHERE id = ?")
      .bind(hop.id)
      .run();
  }
}

async function goalReached(env: Env, bill: BillRow) {
  await addDiary(env, bill, "goal", `${bill.goal_hops} hops. We actually did it. I'd like to thank every pocket that held me.`);
  if (!bill.creator_email) return;
  const followId = `creator:${bill.id}`;
  const optedOut = await env.DB.prepare("SELECT opted_out FROM follows WHERE id = ?").bind(followId).first<{ opted_out: number }>();
  if (optedOut?.opted_out) return;
  await sendMail(env, {
    to: bill.creator_email,
    kind: "goal",
    unsubscribeUrl: appUrl(env, `/f/${followId}?t=${await capToken(env, "follow", followId)}`),
    billId: bill.id,
    serial: bill.serial,
    subject: `${personalityOf(bill).name} hit ${bill.goal_hops} hops. Ready to write the ending?`,
    heading: `${bill.goal_hops} hops. Your move.`,
    paragraphs: [
      `I made it to the goal you set. The story is still moving, and it can keep going forever if you like. But when you're ready, the ending is yours to write: up to twelve words to land it.`,
    ],
    button: { label: "Write the finale", url: appUrl(env, `/b/${bill.serial}?c=${await capToken(env, "creator", bill.id)}`) },
  });
}

// ====================================================================== holder actions

export type ContributeInput = {
  words: string;
  next: string | null;      // email, or null for the wild
  note?: string | null;
  penName?: string | null;
  showCity?: boolean;
  aiAssisted?: boolean;
};

export async function contribute(env: Env, ctx: Ctx, place: Place, bill: BillRow, input: ContributeInput) {
  if (bill.status !== "holding" || !bill.holder_pass_id) throw new UserError("This buck has moved on.", 409);
  if (bill.returned_pass_id) throw new UserError("Your words are already in. Pick someone new, or release it to the wild.", 409);
  const holderPass = (await getPass(env, bill.holder_pass_id))!;
  const words = validateWords(input.words);
  const note = validateShort(input.note, 140, "Your note");
  const signed = await signature(env, input.penName, holderPass.recipient_email);
  const next = input.next ? validateEmail(input.next, "The next person's email") : null;
  if (next && next === holderPass.recipient_email) throw new UserError("You can't pass it to yourself. Nice try.");
  const p = input.showCity === false ? null : place;

  const hopId = newId();
  await env.DB.prepare(
    `INSERT INTO hops (id, bill_id, status, words, content_words, note, pen_name, pen_verified, city, region, country, lat, lng,
       writer_email, writer_pid, received_pass_id, ai_assisted, created_at)
     VALUES (?,?,'pending',?,4,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(hopId, bill.id, words, note, signed.penName, signed.verified, p?.city ?? null, p?.region ?? null, p?.country ?? null, p?.lat ?? null, p?.lng ?? null,
    holderPass.recipient_email, holderPass.recipient_pid ?? await participantId(env, holderPass.recipient_email), holderPass.id, input.aiAssisted ? 1 : 0, now()).run();

  if (!next) {
    await releaseToWild(env, ctx, bill, hopId, holderPass.id, "holding");
    const after = await getBill(env, bill.id);
    if (after?.status !== "wild") throw new UserError("This buck has moved on.", 409);
    return { state: "wild" as const };
  }

  await startPass(env, ctx, bill, { kind: "pass", email: next, fromHopId: hopId, senderPassId: holderPass.id });
  return { state: "in_transit" as const };
}

export async function claimFromWild(env: Env, ctx: Ctx, bill: BillRow, emailIn: string): Promise<{ token: string }> {
  const email = validateEmail(emailIn, "Your email");
  const pass = await startPass(env, ctx, bill, { kind: "claim", email, fromHopId: null, senderPassId: null });
  return { token: await capToken(env, "holder", pass.id) };
}

// ====================================================================== sending it back

/** Who a holder would send the bill back to: a holder's pass, the creator (passId null), or nobody (null: the wild). */
async function senderOf(env: Env, bill: BillRow, pass: PassRow): Promise<{ passId: string | null } | null> {
  if (pass.kind === "claim") return null;
  if (pass.sender_pass_id) return { passId: pass.sender_pass_id };
  // Passes made before senders were recorded: the writer of the words that rode on it.
  const hop = pass.from_hop_id ? await getHop(env, pass.from_hop_id) : null;
  if (hop?.received_pass_id) return { passId: hop.received_pass_id };
  return bill.creator_email ? { passId: null } : null;
}

/**
 * The holder doesn't want it. It goes back to whoever passed it to them, who picks someone
 * else (their words are already in). A claimer puts it back in the wild.
 */
export async function declineBill(env: Env, ctx: Ctx, bill: BillRow): Promise<{ state: "returned" | "wild" }> {
  if (bill.status !== "holding" || !bill.holder_pass_id) throw new UserError("This buck has moved on.", 409);
  if (bill.returned_pass_id) throw new UserError("Your words are already in. Pick someone new, or release it to the wild.", 409);
  const pass = (await getPass(env, bill.holder_pass_id))!;
  const sender = await senderOf(env, bill, pass);
  const t = now();
  const res = await (sender
    ? env.DB.prepare(
        `UPDATE bills SET holder_pass_id = ?, holder_since = ?, held_via_wild = 0, nag_level = 0, returned_pass_id = ?, version = version + 1
         WHERE id = ? AND status = 'holding' AND holder_pass_id = ?`,
      ).bind(sender.passId, t, pass.id, bill.id, pass.id)
    : env.DB.prepare(
        `UPDATE bills SET status = 'wild', wild_since = ?, holder_pass_id = NULL, holder_since = NULL, held_via_wild = 0, nag_level = 0, version = version + 1
         WHERE id = ? AND status = 'holding' AND holder_pass_id = ?`,
      ).bind(t, bill.id, pass.id)
  ).run();
  if (!res.meta.changes) throw new UserError("This buck has moved on.", 409);
  await env.DB.prepare("UPDATE passes SET declined_at = ? WHERE id = ?").bind(t, pass.id).run();
  const after = (await getBill(env, bill.id))!;
  if (!sender) {
    await addDiary(env, after, "wild", "Picked up, looked over, put back. Into the wild again.");
    return { state: "wild" };
  }
  await addDiary(env, after, "returned", "Sent back unopened. Back to the last hands that wanted me.");
  const keeper = await keeperOf(env, after);
  if (keeper) {
    const who = maskEmail(pass.recipient_email);
    ctx.waitUntil(
      sendMail(env, {
        to: keeper.email,
        kind: "returned",
        billId: bill.id,
        serial: bill.serial,
        subject: `${personalityOf(after).name} came back`,
        preheader: `${who} passed. Pick someone else, and your words keep traveling.`,
        heading: "I'm back.",
        paragraphs: [
          `${who} sent me back, so I came home to you. ${sender.passId ? "Your four words are" : "Your foreword is"} still in the story; I just need new hands.`,
          "Pick someone else, or release me into the wild for a stranger to claim.",
        ],
        button: { label: "Pass me to someone else", url: keeper.url },
        footer: "If you just sit on me, I get needy.",
      }),
    );
  }
  return { state: "returned" };
}

/** A bill came back to its sender. They pass it on again with no new words, or release it to the wild. */
export async function repass(env: Env, ctx: Ctx, bill: BillRow, nextIn: string | null): Promise<{ state: "wild" | "in_transit" }> {
  if (bill.status !== "holding" || !bill.returned_pass_id) throw new UserError("This buck has moved on.", 409);
  if (!nextIn) {
    await releaseToWild(env, ctx, bill, null, bill.holder_pass_id, "holding");
    const after = await getBill(env, bill.id);
    if (after?.status !== "wild") throw new UserError("This buck has moved on.", 409);
    return { state: "wild" };
  }
  const next = validateEmail(nextIn, "The next person's email");
  const holderPass = bill.holder_pass_id ? await getPass(env, bill.holder_pass_id) : null;
  if (next === (holderPass?.recipient_email ?? bill.creator_email)) throw new UserError("You can't pass it to yourself. Nice try.");
  const declined = await getPass(env, bill.returned_pass_id);
  if (next === declined?.recipient_email) throw new UserError("They already sent it back. Pick someone else.");
  await startPass(env, ctx, bill, { kind: "pass", email: next, fromHopId: null, senderPassId: bill.holder_pass_id });
  return { state: "in_transit" };
}

// ====================================================================== endings
// The only two ways text reaches a story outside a holder's hop. Both are stored
// on the bill (not as hops) and the bill's own ending is always labeled publicly.

export async function writeCreatorFinale(env: Env, ctx: Ctx, bill: BillRow, wordsIn: string) {
  if (bill.status === "in_transit") throw new UserError("I'm mid-handoff. Give PayPal a few seconds, then try again.", 409);
  if (bill.status !== "holding" && bill.status !== "wild") throw new UserError("This story has already ended.", 409);
  const words = normalizeWords(wordsIn);
  if (words.length > 200) throw new UserError("Your finale is too long (200 characters max).");
  const check = checkFinale(words);
  if (!check.ok) throw new UserError(check.error!);
  if (!isClean(words)) throw new UserError(DIRTY_MESSAGE);
  const res = await env.DB.batch([env.DB.prepare(
    `UPDATE bills SET status = 'complete', finale_text = ?, finale_by = 'creator', ended_at = ?, holder_pass_id = NULL, returned_pass_id = NULL, version = version + 1
     WHERE id = ? AND status IN ('holding', 'wild')`,
  ).bind(words, now(), bill.id),
    env.DB.prepare("INSERT OR IGNORE INTO notification_jobs (id,bill_id,kind,details) SELECT ?,?,'end','{}' FROM bills WHERE id = ? AND status = 'complete'")
      .bind(`end:${bill.id}:end`,bill.id,bill.id),
  ]);
  if (!res[0].meta.changes) throw new UserError("This story just changed. Refresh and try again.", 409);
  const ended = (await getBill(env, bill.id))!;
  await addDiary(env, ended, "finale", `The one who started me wrote the ending. ${ended.hop_count} hops. I'm retiring to a frame on someone's wall.`);
  await notifyFollowers(env, ended, "end", {});
}

export async function writeBillsOwnEnding(env: Env, bill: BillRow, force = false) {
  if (bill.status !== "holding" && bill.status !== "wild") return false;
  const pers = personalityOf(bill);
  const { results: places } = await env.DB.prepare(
    "SELECT city, region, country FROM hops WHERE bill_id = ? AND status = 'confirmed' AND city IS NOT NULL GROUP BY city ORDER BY MIN(idx)",
  ).bind(bill.id).all<{ city: string; region: string | null; country: string | null }>();
  const holder = bill.holder_pass_id
    ? await env.DB.prepare("SELECT city, region, country FROM hops WHERE received_pass_id = ? LIMIT 1").bind(bill.holder_pass_id).first<{ city: string | null; region: string | null; country: string | null }>()
    : null;
  const lastHop = await env.DB.prepare("SELECT city, region, country FROM hops WHERE bill_id = ? AND status = 'confirmed' ORDER BY idx DESC LIMIT 1")
    .bind(bill.id).first<{ city: string | null; region: string | null; country: string | null }>();
  const lastSeen = placeLabel(holder ?? lastHop ?? { city: null, region: null, country: null });
  const e = await ai.writeEulogy(env, {
    pers,
    serial: bill.serial,
    born: bill.origin_city ?? "somewhere",
    bornDate: new Date(bill.created_at).toDateString(),
    places: places.map((p) => placeLabel(p)),
    hopCount: bill.hop_count,
    goal: bill.goal_hops,
    lastSeen,
    storyTail: await storyTail(env, bill.id, 80),
    storyWords: bill.word_count,
    wasWild: bill.status === "wild",
  });
  const res = await env.DB.batch([env.DB.prepare(
    `UPDATE bills SET status = 'eulogized', eulogy = ?, finale_text = ?, finale_by = CASE WHEN ? IS NULL THEN NULL ELSE 'bill' END,
       ended_at = ?, holder_pass_id = NULL, returned_pass_id = NULL, version = version + 1
     WHERE id = ? AND status = ? AND version = ? AND holder_pass_id IS ?
       AND holder_since IS ? AND wild_since IS ?
       AND (? = 1 OR (status = 'holding' AND holder_since < ?) OR (status = 'wild' AND wild_since < ?))`,
  ).bind(e.eulogy, e.closing, e.closing, now(), bill.id, bill.status, bill.version, bill.holder_pass_id,
    bill.holder_since, bill.wild_since, force ? 1 : 0, now() - 14 * DAY, now() - 14 * DAY),
    env.DB.prepare("INSERT OR IGNORE INTO notification_jobs (id,bill_id,kind,details) SELECT ?,?,'end','{}' FROM bills WHERE id = ? AND status = 'eulogized'")
      .bind(`end:${bill.id}:end`,bill.id,bill.id),
  ]);
  if (!res[0].meta.changes) return false;
  const ended = (await getBill(env, bill.id))!;
  await addDiary(env, ended, "death", e.eulogy, { meta: e.meta });
  await notifyFollowers(env, ended, "end", {});
  return true;
}

// ====================================================================== stalls

export async function nag(env: Env, bill: BillRow, level: 1 | 2 | 3) {
  const res = await env.DB.prepare("UPDATE bills SET nag_level = ? WHERE id = ? AND nag_level < ? AND status = 'holding'").bind(level, bill.id, level).run();
  if (!res.meta.changes) return;
  const keeper = await keeperOf(env, bill);
  if (!keeper) return;
  // A bill that came back already has its keeper's words; it only needs new hands.
  const returned = !!bill.returned_pass_id;
  const pers = personalityOf(bill);
  const placeRow = await env.DB.prepare("SELECT city, region, country FROM hops WHERE bill_id = ? AND status = 'confirmed' ORDER BY idx DESC LIMIT 1").bind(bill.id).first<{ city: string | null; region: string | null; country: string | null }>();
  const place = placeRow ? placeLabel(placeRow) : "a pocket somewhere";
  const n = await ai.writeNag(env, { pers, serial: bill.serial, level, place, followers: bill.follower_count, storyTail: await storyTail(env, bill.id, 30), returned });
  await sendMail(env, {
    to: keeper.email,
    kind: `nag${level}`,
    billId: bill.id,
    serial: bill.serial,
    subject: `${pers.name}: ${n.subject}`,
    heading: n.subject,
    paragraphs: [n.body, bill.follower_count > 1 ? `${bill.follower_count} people are watching me. No pressure.` : ""].filter(Boolean),
    button: { label: returned ? "Pick someone new" : "Add your 4 words", url: keeper.url },
    ...(returned ? {} : { secondary: { label: "Not for you? Send me back", url: `${keeper.url}&decline=1` } }),
  });
  if (level >= 2) await addDiary(env, bill, "stall", n.publicNote, { meta: n.meta });
  if (level === 3) await notifyFollowers(env, bill, "stall", { note: n.publicNote });
  await touch(env, bill.id).run();
}

export async function returnToWild(env: Env, bill: BillRow) {
  const res = await env.DB.prepare(
    `UPDATE bills SET status = 'wild', wild_since = ?, holder_pass_id = NULL, holder_since = NULL, held_via_wild = 0, nag_level = 0, version = version + 1
     WHERE id = ? AND status = 'holding' AND held_via_wild = 1 AND holder_pass_id = ?`,
  ).bind(now(), bill.id, bill.holder_pass_id).run();
  if (res.meta.changes) await addDiary(env, bill, "wild", "Whoever claimed me never wrote a word. Back into the wild I go. No hard feelings. Some hard feelings.");
}

// ====================================================================== followers

/**
 * Follow by a typed email: nothing starts until its owner confirms. With a pen name, the confirmation
 * also offers an account: one tap proves the address, confirms the follow and claims the name.
 * Returns whether that offer went out, so the caller can send it separately when this email doesn't.
 */
export async function follow(env: Env, bill: BillRow, emailIn: string, preference: FollowPreference, penName: string | null = null, profile?: ProfileName): Promise<{ offered: boolean }> {
  const email = validateEmail(emailIn);
  const id = newId();
  const pid = await participantId(env, email);
  await env.DB.prepare(`INSERT OR IGNORE INTO follows (id,bill_id,email,pid,preference,verified,created_at) VALUES (?,?,?,?,?,0,?)`)
    .bind(id,bill.id,email,pid,preference,now()).run();
  const row = (await env.DB.prepare("SELECT id,opted_out FROM follows WHERE bill_id = ? AND email = ?").bind(bill.id,email).first<{id: string; opted_out: number}>())!;
  if (row.opted_out) return { offered: false }; // Only the private preferences link can undo an opt-out.
  // Strangers can type any address, across any number of bucks. Cap what one inbox receives.
  const sentToday = await env.DB.prepare("SELECT COUNT(*) AS n FROM follows WHERE pid = ? AND confirmation_sent_at > ?")
    .bind(pid, now() - DAY).first<{ n: number }>();
  if ((sentToday?.n ?? 0) >= FOLLOW_CONFIRMS_PER_RECIPIENT_PER_DAY) return { offered: false };
  const allowed = await env.DB.prepare(`UPDATE follows SET confirmation_sent_at = ? WHERE id = ?
    AND (confirmation_sent_at IS NULL OR confirmation_sent_at < ?)`)
    .bind(now(),row.id,now() - HOUR).run();
  if (!allowed.meta.changes) return { offered: false };
  const manage = appUrl(env, `/f/${row.id}?t=${await capToken(env,"follow",row.id)}`);
  const name = personalityOf(bill).name;
  const offer = penName && !(await challengeLimit(env, email, false))
    ? await createChallenge(env, email, { ...profile, handle: penName, followId: row.id, next: `/b/${bill.serial}`, ttl: OFFER_TTL })
    : null;
  await queueMail(env, {
    deliveryKey: `follow-confirm:${row.id}:${Math.floor(now() / HOUR)}`,
    to: email, kind: "follow_confirm", billId: bill.id, serial: bill.serial,
    ...(offer ? {
      subject: `Follow ${name}, and make “${penName}” yours`,
      heading: "Follow this story, and make it yours?",
      paragraphs: [
        `Someone requested story updates for this address and asked to create a Four Word Pass account with the pen name “${penName}”. One tap does both, and the link works once, for 7 days. Once the pen name is yours, nobody else can sign with it.`,
        "If that wasn't you, ignore this email: nothing is subscribed and no account is created.",
      ],
      button: { label: "Confirm and create my account", url: offer.url },
      secondary: { label: "Just confirm the emails, no account", url: manage },
    } : {
      subject: `Confirm emails from ${name}`,
      heading: "Follow this story?",
      paragraphs: ["Someone requested story updates for this address. Open the link and confirm your preference to start receiving them. If that wasn't you, ignore this email; you haven't been subscribed."],
      button: { label: "Confirm or manage emails", url: manage },
    }),
    unsubscribeUrl: manage,
  });
  return { offered: !!offer };
}

/** Change or stop one subscription, from its emailed manage link or its owner's dashboard. */
export async function setFollowPreference(env: Env, followId: string, billId: string, preference: FollowPreference | "unfollow") {
  await env.DB.batch([
    preference === "unfollow"
      ? env.DB.prepare("UPDATE follows SET verified = 0, opted_out = 1 WHERE id = ?").bind(followId)
      : env.DB.prepare("UPDATE follows SET preference = ?, verified = 1, opted_out = 0 WHERE id = ?").bind(preference, followId),
    env.DB.prepare("UPDATE bills SET follower_count = (SELECT COUNT(*) FROM follows WHERE bill_id = ?1 AND verified = 1), version = version + 1 WHERE id = ?1").bind(billId),
  ]);
}

/**
 * Follow without a confirmation email, for an address that's already proven: a signed-in
 * account, or the holder's own address from the link we emailed them. An explicit follow
 * from the proven owner also lifts an earlier opt-out.
 */
export async function followVerified(env: Env, bill: BillRow, emailIn: string, preference: FollowPreference) {
  const email = validateEmail(emailIn);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO follows (id,bill_id,email,pid,preference,verified,created_at) VALUES (?,?,?,?,?,1,?)
      ON CONFLICT(bill_id,email) DO UPDATE SET preference = excluded.preference, verified = 1, opted_out = 0, pid = excluded.pid`)
      .bind(newId(), bill.id, email, await participantId(env, email), preference, now()),
    env.DB.prepare("UPDATE bills SET follower_count = (SELECT COUNT(*) FROM follows WHERE bill_id = ?1 AND verified = 1), version = version + 1 WHERE id = ?1").bind(bill.id),
  ]);
}

async function notifyFollowers(env: Env, bill: BillRow, kind: "hop" | "end" | "stall", p: { hop?: HopRow; diaryLine?: string | null; note?: string }) {
  const id = `${kind}:${bill.id}:${kind === "hop" ? p.hop!.id : kind === "stall" ? bill.holder_since : "end"}`;
  await env.DB.prepare("INSERT OR IGNORE INTO notification_jobs (id,bill_id,kind,details) VALUES (?,?,?,?)")
    .bind(id, bill.id, kind, JSON.stringify(p)).run();
}

export async function runNotificationJobs(env: Env) {
  const {results} = await env.DB.prepare("SELECT * FROM notification_jobs WHERE done = 0 LIMIT 4")
    .all<{id: string; bill_id: string; kind: "hop" | "end" | "stall"; details: string; cursor: string}>();
  for (const job of results) {
    const bill = await getBill(env, job.bill_id);
    if (!bill) continue;
    await sendFollowerPage(env, bill, job.kind, JSON.parse(job.details), job);
  }
}

async function sendFollowerPage(env: Env, bill: BillRow, kind: "hop" | "end" | "stall", p: { hop?: HopRow; diaryLine?: string | null; note?: string }, job: {id: string; cursor: string}) {
  const prefs = kind === "end" ? ["every_hop", "on_end"] : ["every_hop"];
  const { results } = await env.DB.prepare(`SELECT id, email, hop_mail_at FROM follows WHERE bill_id = ? AND verified = 1 AND id > ? AND preference IN (${prefs.map(() => "?").join(",")}) ORDER BY id LIMIT 100`)
    .bind(bill.id, job.cursor, ...prefs)
    .all<{ id: string; email: string; hop_mail_at: number | null }>();
  const url = appUrl(env, `/b/${bill.serial}`);
  const name = personalityOf(bill).name;
  const tail = kind === "end" ? await storyTail(env, bill.id, 40) : "";
  for (const f of results) {
    if (kind === "hop" && p.hop?.writer_email === f.email) continue; // they know; they wrote it
    // A fast-moving buck shouldn't bury its followers; the page always has every hop.
    if (kind === "hop" && f.hop_mail_at && f.hop_mail_at > now() - HOP_MAIL_GAP) continue;
    const unsubscribeUrl = appUrl(env, `/f/${f.id}?t=${await capToken(env, "follow", f.id)}`);
    if (kind === "hop" && p.hop) {
      const place = hopPlace(p.hop);
      await queueMail(env, {
        deliveryKey: `${job.id}:${f.id}`, subscriptionId: f.id,
        to: f.email, kind: "follower_hop", billId: bill.id, serial: bill.serial,
        subject: `${name} moved: hop ${p.hop.idx}, ${place}`,
        heading: `Hop ${p.hop.idx}, ${place}.`,
        paragraphs: p.diaryLine ? [p.diaryLine] : [],
        quote: p.hop.words, quoteLabel: p.hop.pen_name ? `New words from ${p.hop.pen_name}` : `New words from a stranger in ${place}`,
        button: { label: "Read the whole story", url }, unsubscribeUrl,
      });
      await env.DB.prepare("UPDATE follows SET hop_mail_at = ? WHERE id = ?").bind(now(), f.id).run();
    } else if (kind === "stall") {
      await queueMail(env, {
        deliveryKey: `${job.id}:${f.id}`, subscriptionId: f.id,
        to: f.email, kind: "follower_stall", billId: bill.id, serial: bill.serial,
        subject: `${name} hasn't moved in a week`,
        heading: "I'm stuck.",
        paragraphs: [p.note ?? "", "Seven days in one pocket. If you know who has me, a little social pressure wouldn't hurt."].filter(Boolean),
        button: { label: "See where I'm stuck", url }, unsubscribeUrl,
      });
    } else {
      const lost = bill.status === "eulogized";
      await queueMail(env, {
        deliveryKey: `${job.id}:${f.id}`, subscriptionId: f.id,
        to: f.email, kind: "follower_end", billId: bill.id, serial: bill.serial,
        subject: lost ? `${name} has been declared lost` : `${name}: the end`,
        heading: lost ? "Pour one out." : "The end.",
        paragraphs: lost ? [bill.eulogy ?? ""] : [`My creator wrote the finale. ${bill.hop_count} hops, ${bill.word_count} words, all by strangers.`],
        quote: [tail, bill.finale_text].filter(Boolean).join(" "),
        quoteLabel: lost && bill.finale_by === "bill" ? "How it ends (the last line is mine; my creator never came back)" : "How it ends",
        button: { label: "Read the whole story", url }, unsubscribeUrl,
      });
    }
  }
  await env.DB.prepare("UPDATE notification_jobs SET cursor = ?, done = ? WHERE id = ?")
    .bind(results.at(-1)?.id ?? job.cursor, results.length < 100 ? 1 : 0, job.id).run();
}
