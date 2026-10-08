// The bill lifecycle. Every state change goes through here.
//
// Model:
//  - A *pass* is $1 moving from the platform to a person (PayPal payout).
//  - A *hop* is four words written by whoever holds the bill.
//  - Words leave your hands one of two ways: a payout to the next person lands
//    (webhook or poll), or you release the bill into the wild (the platform holds
//    the dollar until someone claims it). Until then, they're pending.
//  - You hold the buck only once your dollar has landed.
//
// All transitions are conditional UPDATEs, so duplicate webhooks, racing polls
// and double-clicks are no-ops.

import { checkFinale, checkFourWords, isEmail, maskEmail, normalizeWords } from "../shared/words";
import { SERIAL_PREFIX } from "../shared/brand";
import type { FollowPreference } from "../shared/types";
import * as ai from "./ai";
import { type BillRow, type HopRow, type PassRow, getBill, getHop, getPass, personalityOf, storyTail, touch } from "./db";
import { sendMail } from "./email";
import { DIRTY_MESSAGE, isClean } from "./moderation";
import { DELIVERED, FAILED, type PayoutState, captureOrder, createPayout, getPayout, paypalMode } from "./paypal";
import { DAY, type Place, appUrl, capToken, newId, now, placeLabel, sleep } from "./util";

export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Ctx = { waitUntil(p: Promise<unknown>): void };

const lower = (s: string) => s.trim().toLowerCase();

function validateWords(words: string): string {
  const clean = normalizeWords(words);
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

function validateEmail(email: string | null | undefined, label = "That email"): string {
  const e = lower(email ?? "");
  if (!isEmail(e)) throw new UserError(`${label} doesn't look right.`);
  return e;
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
const confirmHopStmt = (env: Env, hopId: string, billId: string) =>
  env.DB.prepare(
    `UPDATE hops SET status = 'confirmed', confirmed_at = ?1,
       idx = (SELECT COALESCE(MAX(idx), 0) + 1 FROM hops WHERE bill_id = ?2)
     WHERE id = ?3 AND status = 'pending'`,
  ).bind(now(), billId, hopId);

async function addDiary(env: Env, bill: BillRow, kind: string, text: string, opts: { hopId?: string; place?: string; meta?: ai.AiMeta } = {}) {
  const t = now();
  await env.DB.prepare("INSERT INTO diary (id, bill_id, hop_id, kind, day_label, text, ai_meta, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(newId(), bill.id, opts.hopId ?? null, kind, `Day ${dayOf(bill, t)}${opts.place ? ` — ${opts.place}` : ""}`, text, opts.meta ? JSON.stringify(opts.meta) : null, t)
    .run();
}

// ====================================================================== mint / fork

export type MintInput = {
  orderId: string;
  creatorEmail: string;
  words: string;
  theme?: string | null;
  goal?: number | null;
  firstRecipient?: string | null;   // null → release straight into the wild
  penName?: string | null;
  showCity?: boolean;
  fork?: { parentSerial: string; atHop: number };
};

export async function mintBill(env: Env, ctx: Ctx, place: Place, input: MintInput): Promise<{ serial: string; creatorToken: string }> {
  const creatorEmail = validateEmail(input.creatorEmail, "Your email");
  const words = validateWords(input.words);
  const theme = validateShort(input.theme, 140, "The theme");
  const penName = validateShort(input.penName, 24, "Your pen name");
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

  // Money in first. If the capture fails, nothing is created.
  const used = await env.DB.prepare("SELECT 1 FROM bills WHERE checkout_order_id = ?").bind(input.orderId).first();
  if (used) throw new UserError("That payment already minted a bill.");
  try {
    await captureOrder(env, input.orderId);
  } catch (e) {
    throw new UserError(`Checkout didn't go through: ${(e as Error).message}`, 402);
  }

  const billId = newId();
  const t = now();
  const origin = input.showCity === false ? null : place;
  // Serials are sequential and never reused. Retry if two mints race for the same seq.
  for (let attempt = 0; ; attempt++) {
    try {
      await env.DB.prepare(
        `INSERT INTO bills (id, seq, serial, status, theme, goal_hops, creator_email, origin_city, origin_lat, origin_lng,
           forked_from_bill_id, forked_at_hop, checkout_order_id, created_at)
         SELECT ?1, s, ?12 || '-' || printf('%04d', s), 'in_transit', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
         FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM bills)`,
      )
        .bind(billId, theme ?? parent?.theme ?? null, goal, creatorEmail, origin ? placeLabel(origin) : null, origin?.lat ?? null, origin?.lng ?? null,
          parent?.id ?? null, input.fork?.atHop ?? null, input.orderId, t, SERIAL_PREFIX)
        .run();
      break;
    } catch (e) {
      if (attempt >= 3 || !String(e).includes("UNIQUE")) throw e;
    }
  }
  let bill = (await getBill(env, billId))!;

  // A fork carries the parent's story up to the fork point. Copies are display-only;
  // the writers' private details stay with the original hops.
  if (parent && input.fork) {
    await env.DB.prepare(
      `INSERT INTO hops (id, bill_id, idx, status, words, content_words, note, pen_name, city, region, country, lat, lng,
         inherited_from_hop_id, stamp_key, stamp_status, diary_done, followers_notified, created_at, confirmed_at)
       SELECT lower(hex(randomblob(16))), ?1, idx, 'confirmed', words, content_words, note, pen_name, city, region, country, lat, lng,
         COALESCE(inherited_from_hop_id, id), stamp_key, CASE WHEN stamp_status = 'ready' THEN 'ready' ELSE 'none' END, 1, 1, created_at, confirmed_at
       FROM hops WHERE bill_id = ?2 AND status = 'confirmed' AND idx <= ?3`,
    ).bind(billId, parent.id, input.fork.atHop).run();
  }

  const pers = await ai.makePersonality(env, {
    theme: theme ?? parent?.theme ?? null,
    origin: origin ? placeLabel(origin) : "an undisclosed location",
    serial: bill.serial,
    parentName: parent ? `${parent.serial} (${personalityOf(parent).name})` : undefined,
    openingWords: words,
  });
  const hopId = newId();
  const followId = newId();
  await env.DB.batch([
    env.DB.prepare("UPDATE bills SET personality = ? WHERE id = ?").bind(JSON.stringify(pers.personality), billId),
    env.DB.prepare(
      `INSERT INTO hops (id, bill_id, status, words, content_words, pen_name, city, region, country, lat, lng, writer_email, created_at)
       VALUES (?,?,'pending',?,4,?,?,?,?,?,?,?,?)`,
    ).bind(hopId, billId, words, penName, origin?.city ?? null, origin?.region ?? null, origin?.country ?? null, origin?.lat ?? null, origin?.lng ?? null, creatorEmail, t),
    env.DB.prepare("INSERT INTO follows (id, bill_id, email, preference, created_at) VALUES (?,?,?,?,?)").bind(followId, billId, creatorEmail, "every_hop", t),
    env.DB.prepare("UPDATE bills SET follower_count = 1 WHERE id = ?").bind(billId),
    recountStmt(env, billId),
  ]);
  bill = (await getBill(env, billId))!;
  await addDiary(env, bill, "birth", pers.birthEntry, { place: origin ? placeLabel(origin) : undefined, meta: pers.meta });

  const creatorToken = await capToken(env, "creator", billId);
  if (firstRecipient) {
    await startPass(env, ctx, bill, { kind: parent ? "fork" : "mint", email: firstRecipient, fromHopId: hopId });
  } else {
    await releaseToWild(env, ctx, bill, hopId, null);
  }

  const share = appUrl(env, `/b/${bill.serial}`);
  ctx.waitUntil(
    sendMail(env, {
      to: creatorEmail,
      kind: "creator",
      billId,
      fromName: bill.serial,
      subject: `${bill.serial} is out in the world`,
      heading: `I'm ${pers.personality.name}.`,
      paragraphs: [
        `${pers.personality.tagline} Thanks for printing me. I'm ${bill.serial}, and I'm ${firstRecipient ? `on my way to ${maskEmail(firstRecipient)}` : "loose in the wild, waiting for someone to pick me up"}.`,
        "You're following every hop. When the story's ready to end, you write the finale. Keep this email: the button below is your key.",
        `Share my page: ${share}`,
      ],
      quote: words,
      quoteLabel: "Your opening words",
      button: { label: "End the story (when it's time)", url: appUrl(env, `/b/${bill.serial}?c=${creatorToken}`) },
      unsubscribeUrl: appUrl(env, `/f/${followId}?t=${await capToken(env, "follow", followId)}`),
    }),
  );
  return { serial: bill.serial, creatorToken };
}

// ====================================================================== passes (money)

async function startPass(env: Env, ctx: Ctx, bill: BillRow, p: { kind: PassRow["kind"]; email: string; fromHopId: string | null }): Promise<PassRow> {
  const passId = newId();
  const t = now();
  const mode = paypalMode(env);
  await env.DB.prepare(
    "INSERT INTO passes (id, bill_id, kind, recipient_email, from_hop_id, status, paypal_mode, next_poll_at, created_at) VALUES (?,?,?,?,?,'pending',?,?,?)",
  ).bind(passId, bill.id, p.kind, p.email, p.fromHopId, mode, t + 3000, t).run();

  const n = bill.hop_count + (p.fromHopId ? 1 : 0);
  const url = appUrl(env, `/b/${bill.serial}`).replace(/^https?:\/\//, "");
  try {
    const { batchId } = await createPayout(env, {
      passId,
      email: p.email,
      subject: `${bill.serial} is yours`,
      message: `A dollar with a story just landed. Add your four words and pass it on: ${url}`,
      note: `${bill.serial} is yours. ${n} ${n === 1 ? "stranger is" : "strangers are"} writing its story.\nAdd your 4 words: ${url}`,
    });
    await env.DB.prepare("UPDATE passes SET payout_batch_id = ?, paypal_status = 'PENDING' WHERE id = ?").bind(batchId, passId).run();
  } catch (e) {
    const pass = (await getPass(env, passId))!;
    await failPass(env, ctx, pass, { status: "FAILED", itemId: null, transactionId: null, error: (e as Error).message });
    throw new UserError(`PayPal couldn't send to that address: ${(e as Error).message}`);
  }
  ctx.waitUntil(quickPoll(env, ctx, passId));
  return (await getPass(env, passId))!;
}

/** Sandbox payouts usually settle in seconds. Poll right away so the handoff feels live. */
async function quickPoll(env: Env, ctx: Ctx, passId: string) {
  for (const wait of [3000, 3000, 4000, 6000, 8000]) {
    await sleep(wait);
    const pass = await getPass(env, passId);
    if (!pass || pass.status !== "pending") return;
    await pollPass(env, ctx, pass).catch((e) => console.error("poll failed", e));
  }
}

export async function pollPass(env: Env, ctx: Ctx, pass: PassRow) {
  if (!pass.payout_batch_id) return;
  const state = await getPayout(env, pass.payout_batch_id);
  const backoff = Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, pass.poll_count - 4));
  await env.DB.prepare("UPDATE passes SET poll_count = poll_count + 1, next_poll_at = ? WHERE id = ?").bind(now() + backoff, pass.id).run();
  await applyPayoutState(env, ctx, pass, state);
}

export async function applyPayoutState(env: Env, ctx: Ctx, pass: PassRow, state: PayoutState) {
  if (DELIVERED.has(state.status)) return deliverPass(env, ctx, pass, state);
  if (FAILED.has(state.status)) return failPass(env, ctx, pass, state);
  if (state.status !== pass.paypal_status) {
    await env.DB.batch([
      env.DB.prepare("UPDATE passes SET paypal_status = ?, payout_item_id = COALESCE(?, payout_item_id) WHERE id = ? AND status = 'pending'").bind(state.status, state.itemId, pass.id),
      touch(env, pass.bill_id),
    ]);
  }
}

async function deliverPass(env: Env, ctx: Ctx, pass: PassRow, state: PayoutState) {
  const t = now();
  const res = await env.DB.prepare(
    "UPDATE passes SET status = 'delivered', paypal_status = ?, payout_item_id = COALESCE(?, payout_item_id), transaction_id = ?, settled_at = ? WHERE id = ? AND status = 'pending'",
  ).bind(state.status, state.itemId, state.transactionId, t, pass.id).run();
  if (!res.meta.changes) return; // already settled

  const stmts = [];
  if (pass.from_hop_id) stmts.push(confirmHopStmt(env, pass.from_hop_id, pass.bill_id));
  stmts.push(
    env.DB.prepare(
      `UPDATE bills SET status = 'holding', holder_pass_id = ?, holder_since = ?, held_via_wild = ?, wild_since = NULL, nag_level = 0
       WHERE id = ? AND status = 'in_transit'`,
    ).bind(pass.id, t, pass.kind === "claim" ? 1 : 0, pass.bill_id),
    recountStmt(env, pass.bill_id),
  );
  await env.DB.batch(stmts);
  ctx.waitUntil(afterDelivery(env, pass.id));
}

async function failPass(env: Env, ctx: Ctx, pass: PassRow, state: PayoutState) {
  const t = now();
  const res = await env.DB.prepare(
    "UPDATE passes SET status = 'failed', paypal_status = ?, error = ?, settled_at = ? WHERE id = ? AND status = 'pending'",
  ).bind(state.status, state.error ?? state.status, t, pass.id).run();
  if (!res.meta.changes) return;
  const bill = (await getBill(env, pass.bill_id))!;

  if (pass.kind === "pass") {
    // The holder keeps the bill and their words; they pick someone else.
    await env.DB.batch([
      env.DB.prepare("UPDATE hops SET status = 'void' WHERE id = ? AND status = 'pending'").bind(pass.from_hop_id),
      env.DB.prepare("UPDATE bills SET status = 'holding' WHERE id = ? AND status = 'in_transit'").bind(bill.id),
      touch(env, bill.id),
    ]);
    const holderPass = bill.holder_pass_id ? await getPass(env, bill.holder_pass_id) : null;
    if (holderPass) {
      ctx.waitUntil(
        sendMail(env, {
          to: holderPass.recipient_email,
          kind: "pass_failed",
          billId: bill.id,
          fromName: bill.serial,
          subject: `I couldn't reach ${maskEmail(pass.recipient_email)}`,
          heading: "Still in your pocket.",
          paragraphs: [
            `PayPal couldn't deliver me to ${maskEmail(pass.recipient_email)}, so your words are on hold. Pick someone else, or release me into the wild.`,
          ],
          button: { label: "Pass me to someone else", url: appUrl(env, `/b/${bill.serial}?t=${await capToken(env, "holder", holderPass.id)}`) },
        }),
      );
    }
  } else if (pass.kind === "claim") {
    await env.DB.batch([
      env.DB.prepare("UPDATE bills SET status = 'wild', wild_since = ? WHERE id = ? AND status = 'in_transit'").bind(t, bill.id),
      touch(env, bill.id),
    ]);
  } else {
    // Mint/fork recipient unreachable: the creator already paid, so don't strand
    // the bill. Their opening words land and it goes wild instead.
    await releaseToWild(env, ctx, bill, pass.from_hop_id, null, "in_transit");
    if (bill.creator_email) {
      ctx.waitUntil(
        sendMail(env, {
          to: bill.creator_email,
          kind: "mint_failed",
          billId: bill.id,
          fromName: bill.serial,
          subject: `I couldn't reach ${maskEmail(pass.recipient_email)}, so I went wild`,
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
  const stmts = [];
  if (hopId) stmts.push(confirmHopStmt(env, hopId, bill.id));
  stmts.push(
    env.DB.prepare(
      `UPDATE bills SET status = 'wild', wild_since = ?, holder_pass_id = NULL, holder_since = NULL, held_via_wild = 0, nag_level = 0
       WHERE id = ? AND status = ? AND (? IS NULL OR holder_pass_id = ?)`,
    ).bind(t, bill.id, fromStatus, holderPassId, holderPassId),
    recountStmt(env, bill.id),
  );
  await env.DB.batch(stmts);
  if (hopId) ctx.waitUntil(runHopEffects(env, hopId));
}

// ====================================================================== after a hop lands

/** Idempotent; also re-run by cron for anything waitUntil didn't finish. */
export async function afterDelivery(env: Env, passId: string) {
  const pass = await getPass(env, passId);
  if (!pass || pass.status !== "delivered") return;
  if (!pass.holder_notified) {
    const claimed = await env.DB.prepare("UPDATE passes SET holder_notified = 1 WHERE id = ? AND holder_notified = 0").bind(passId).run();
    if (claimed.meta.changes) await emailHolder(env, pass);
  }
  if (pass.from_hop_id) await runHopEffects(env, pass.from_hop_id);
}

async function emailHolder(env: Env, pass: PassRow, resend = false) {
  const bill = (await getBill(env, pass.bill_id))!;
  if (bill.holder_pass_id !== pass.id || bill.status !== "holding") return;
  const pers = personalityOf(bill);
  const tail = await storyTail(env, bill.id, 30);
  const places = await env.DB.prepare("SELECT COUNT(DISTINCT city) AS n FROM hops WHERE bill_id = ? AND status = 'confirmed' AND city IS NOT NULL").bind(bill.id).first<{ n: number }>();
  const n = bill.hop_count;
  await sendMail(env, {
    to: pass.recipient_email,
    kind: resend ? "holder_resend" : "holder",
    billId: bill.id,
    fromName: bill.serial,
    subject: `${bill.serial} is yours`,
    heading: `${bill.serial} is yours.`,
    paragraphs: [
      `I'm ${pers.name}. ${n} ${n === 1 ? "stranger has" : "strangers have"} written my story so far${places?.n ? `, across ${places.n} ${places.n === 1 ? "place" : "places"}` : ""}. Now it's your turn: add exactly four words, then pass me on.`,
      `PayPal just sent you $1.00${pass.paypal_mode === "sandbox" ? " (sandbox)" : pass.paypal_mode === "mock" ? " (simulated)" : ""}. That's me. No account or app needed here; it takes about a minute.`,
    ],
    quote: tail || undefined,
    quoteLabel: tail ? "The story so far" : undefined,
    button: { label: "Add your 4 words", url: appUrl(env, `/b/${bill.serial}?t=${await capToken(env, "holder", pass.id)}`) },
    footer: pass.kind === "claim" ? "You claimed me from the wild. You have 24 hours before I wander back out." : "If you sit on me, I get needy. You've been warned.",
  });
}

export async function resendHolderLink(env: Env, bill: BillRow) {
  if (bill.status !== "holding" || !bill.holder_pass_id) return;
  const pass = await getPass(env, bill.holder_pass_id);
  if (pass) await emailHolder(env, pass, true);
}

export async function runHopEffects(env: Env, hopId: string) {
  let hop = await getHop(env, hopId);
  if (!hop || hop.status !== "confirmed" || hop.inherited_from_hop_id) return;
  const bill = (await getBill(env, hop.bill_id))!;
  const pers = personalityOf(bill);
  const place = hopPlace(hop);
  let motif = `${place} street scene`;
  let diaryLine: string | null = null;

  if (!hop.diary_done) {
    const claimed = await env.DB.prepare("UPDATE hops SET diary_done = 1 WHERE id = ? AND diary_done = 0").bind(hopId).run();
    if (claimed.meta.changes) {
      const tail = await storyTail(env, bill.id, 60);
      const d = await ai.writeDiary(env, {
        pers, serial: bill.serial, words: hop.words, note: hop.note, place, hopNumber: hop.idx ?? bill.hop_count,
        day: dayOf(bill, hop.confirmed_at ?? now()), storyTail: tail, goal: bill.goal_hops, penName: hop.pen_name,
      });
      motif = d.motif;
      diaryLine = d.entry;
      await addDiary(env, bill, "hop", d.entry, { hopId, place, meta: d.meta });
      await touch(env, bill.id).run();
    }
  }

  if (!hop.followers_notified) {
    const claimed = await env.DB.prepare("UPDATE hops SET followers_notified = 1 WHERE id = ? AND followers_notified = 0").bind(hopId).run();
    if (claimed.meta.changes) await notifyFollowers(env, bill, "hop", { hop, diaryLine });
  }

  if (bill.goal_hops && bill.hop_count >= bill.goal_hops && !bill.goal_notified) {
    const claimed = await env.DB.prepare("UPDATE bills SET goal_notified = 1 WHERE id = ? AND goal_notified = 0").bind(bill.id).run();
    if (claimed.meta.changes) await goalReached(env, bill);
  }

  hop = (await getHop(env, hopId))!;
  if (hop.stamp_status === "pending") await paintHopStamp(env, hop, motif);
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
  await sendMail(env, {
    to: bill.creator_email,
    kind: "goal",
    billId: bill.id,
    fromName: bill.serial,
    subject: `${bill.serial} hit ${bill.goal_hops} hops`,
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
  const holderPass = (await getPass(env, bill.holder_pass_id))!;
  const words = validateWords(input.words);
  const note = validateShort(input.note, 140, "Your note");
  const penName = validateShort(input.penName, 24, "Your pen name");
  const next = input.next ? validateEmail(input.next, "The next person's email") : null;
  if (next && next === holderPass.recipient_email) throw new UserError("You can't pass it to yourself. Nice try.");
  const p = input.showCity === false ? null : place;

  const hopId = newId();
  await env.DB.prepare(
    `INSERT INTO hops (id, bill_id, status, words, content_words, note, pen_name, city, region, country, lat, lng,
       writer_email, received_pass_id, ai_assisted, created_at)
     VALUES (?,?,'pending',?,4,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(hopId, bill.id, words, note, penName, p?.city ?? null, p?.region ?? null, p?.country ?? null, p?.lat ?? null, p?.lng ?? null,
    holderPass.recipient_email, holderPass.id, input.aiAssisted ? 1 : 0, now()).run();

  if (!next) {
    await releaseToWild(env, ctx, bill, hopId, holderPass.id, "holding");
    const after = await getBill(env, bill.id);
    if (after?.status !== "wild") throw new UserError("This buck has moved on.", 409);
    return { state: "wild" as const };
  }

  const moved = await env.DB.prepare("UPDATE bills SET status = 'in_transit', version = version + 1 WHERE id = ? AND status = 'holding' AND holder_pass_id = ?")
    .bind(bill.id, holderPass.id)
    .run();
  if (!moved.meta.changes) {
    await env.DB.prepare("UPDATE hops SET status = 'void' WHERE id = ?").bind(hopId).run();
    throw new UserError("This buck has moved on.", 409);
  }
  await startPass(env, ctx, bill, { kind: "pass", email: next, fromHopId: hopId });
  return { state: "in_transit" as const };
}

export async function claimFromWild(env: Env, ctx: Ctx, bill: BillRow, emailIn: string): Promise<{ token: string }> {
  const email = validateEmail(emailIn, "Your email");
  const res = await env.DB.prepare("UPDATE bills SET status = 'in_transit', version = version + 1 WHERE id = ? AND status = 'wild'").bind(bill.id).run();
  if (!res.meta.changes) throw new UserError("Someone beat you to it.", 409);
  const pass = await startPass(env, ctx, bill, { kind: "claim", email, fromHopId: null });
  return { token: await capToken(env, "holder", pass.id) };
}

// ====================================================================== endings
// The only two ways text reaches a story outside a holder's hop. Both are stored
// on the bill (not as hops) and the bill's own ending is always labeled publicly.

export async function writeCreatorFinale(env: Env, ctx: Ctx, bill: BillRow, wordsIn: string) {
  if (bill.status === "in_transit") throw new UserError("I'm mid-handoff. Give PayPal a few seconds, then try again.", 409);
  if (bill.status !== "holding" && bill.status !== "wild") throw new UserError("This story has already ended.", 409);
  const words = normalizeWords(wordsIn);
  const check = checkFinale(words);
  if (!check.ok) throw new UserError(check.error!);
  if (!isClean(words)) throw new UserError(DIRTY_MESSAGE);
  const res = await env.DB.prepare(
    `UPDATE bills SET status = 'complete', finale_text = ?, finale_by = 'creator', ended_at = ?, holder_pass_id = NULL, version = version + 1
     WHERE id = ? AND status IN ('holding', 'wild')`,
  ).bind(words, now(), bill.id).run();
  if (!res.meta.changes) throw new UserError("This story just changed. Refresh and try again.", 409);
  const ended = (await getBill(env, bill.id))!;
  await addDiary(env, ended, "finale", `The one who started me wrote the ending. ${ended.hop_count} hops. I'm retiring to a frame on someone's wall.`);
  ctx.waitUntil(notifyFollowers(env, ended, "end", {}));
}

export async function writeBillsOwnEnding(env: Env, bill: BillRow) {
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
  const res = await env.DB.prepare(
    `UPDATE bills SET status = 'eulogized', eulogy = ?, finale_text = ?, finale_by = CASE WHEN ? IS NULL THEN NULL ELSE 'bill' END,
       ended_at = ?, holder_pass_id = NULL, version = version + 1
     WHERE id = ? AND status IN ('holding', 'wild')`,
  ).bind(e.eulogy, e.closing, e.closing, now(), bill.id).run();
  if (!res.meta.changes) return;
  const ended = (await getBill(env, bill.id))!;
  await addDiary(env, ended, "death", e.eulogy, { meta: e.meta });
  await notifyFollowers(env, ended, "end", {});
}

// ====================================================================== stalls

export async function nag(env: Env, bill: BillRow, level: 1 | 2 | 3) {
  const res = await env.DB.prepare("UPDATE bills SET nag_level = ? WHERE id = ? AND nag_level < ? AND status = 'holding'").bind(level, bill.id, level).run();
  if (!res.meta.changes || !bill.holder_pass_id) return;
  const pass = await getPass(env, bill.holder_pass_id);
  if (!pass) return;
  const pers = personalityOf(bill);
  const placeRow = await env.DB.prepare("SELECT city, region, country FROM hops WHERE bill_id = ? AND status = 'confirmed' ORDER BY idx DESC LIMIT 1").bind(bill.id).first<{ city: string | null; region: string | null; country: string | null }>();
  const place = placeRow ? placeLabel(placeRow) : "a pocket somewhere";
  const n = await ai.writeNag(env, { pers, serial: bill.serial, level, place, followers: bill.follower_count, storyTail: await storyTail(env, bill.id, 30) });
  await sendMail(env, {
    to: pass.recipient_email,
    kind: `nag${level}`,
    billId: bill.id,
    fromName: bill.serial,
    subject: n.subject,
    heading: n.subject,
    paragraphs: [n.body, bill.follower_count > 1 ? `${bill.follower_count} people are watching me. No pressure.` : ""].filter(Boolean),
    button: { label: "Add your 4 words", url: appUrl(env, `/b/${bill.serial}?t=${await capToken(env, "holder", pass.id)}`) },
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

export async function follow(env: Env, bill: BillRow, emailIn: string, preference: FollowPreference) {
  const email = validateEmail(emailIn);
  const id = newId();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO follows (id, bill_id, email, preference, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(bill_id, email) DO UPDATE SET preference = excluded.preference`,
    ).bind(id, bill.id, email, preference, now()),
    env.DB.prepare("UPDATE bills SET follower_count = (SELECT COUNT(*) FROM follows WHERE bill_id = ?1), version = version + 1 WHERE id = ?1").bind(bill.id),
  ]);
  const row = (await env.DB.prepare("SELECT id FROM follows WHERE bill_id = ? AND email = ?").bind(bill.id, email).first<{ id: string }>())!;
  await sendMail(env, {
    to: email,
    kind: "follow",
    billId: bill.id,
    fromName: bill.serial,
    subject: `You're following ${bill.serial}`,
    heading: "You're following me.",
    paragraphs: [
      preference === "every_hop"
        ? "You'll hear from me every time I change hands: the new words, where I landed, and what I thought about it."
        : "You'll hear from me once, when my story ends: a finale from my creator, or my eulogy if I get lost.",
    ],
    button: { label: `See ${bill.serial}`, url: appUrl(env, `/b/${bill.serial}`) },
    unsubscribeUrl: appUrl(env, `/f/${row.id}?t=${await capToken(env, "follow", row.id)}`),
  });
}

async function notifyFollowers(env: Env, bill: BillRow, kind: "hop" | "end" | "stall", p: { hop?: HopRow; diaryLine?: string | null; note?: string }) {
  const prefs = kind === "end" ? ["every_hop", "on_end"] : ["every_hop"];
  const { results } = await env.DB.prepare(`SELECT id, email FROM follows WHERE bill_id = ? AND preference IN (${prefs.map(() => "?").join(",")}) LIMIT 500`)
    .bind(bill.id, ...prefs)
    .all<{ id: string; email: string }>();
  if (!results.length) return;
  const url = appUrl(env, `/b/${bill.serial}`);
  const tail = kind === "end" ? await storyTail(env, bill.id, 40) : "";
  for (const f of results) {
    if (kind === "hop" && p.hop?.writer_email === f.email) continue; // they know; they wrote it
    const unsubscribeUrl = appUrl(env, `/f/${f.id}?t=${await capToken(env, "follow", f.id)}`);
    if (kind === "hop" && p.hop) {
      const place = hopPlace(p.hop);
      await sendMail(env, {
        to: f.email, kind: "follower_hop", billId: bill.id, fromName: bill.serial,
        subject: `Hop ${p.hop.idx}: ${place}`,
        heading: `Hop ${p.hop.idx}, ${place}.`,
        paragraphs: p.diaryLine ? [p.diaryLine] : [],
        quote: p.hop.words, quoteLabel: p.hop.pen_name ? `New words from ${p.hop.pen_name}` : `New words from a stranger in ${place}`,
        button: { label: "Read the whole story", url }, unsubscribeUrl,
      });
    } else if (kind === "stall") {
      await sendMail(env, {
        to: f.email, kind: "follower_stall", billId: bill.id, fromName: bill.serial,
        subject: `${bill.serial} hasn't moved in a week`,
        heading: "I'm stuck.",
        paragraphs: [p.note ?? "", "Seven days in one pocket. If you know who has me, a little social pressure wouldn't hurt."].filter(Boolean),
        button: { label: "See where I'm stuck", url }, unsubscribeUrl,
      });
    } else {
      const lost = bill.status === "eulogized";
      await sendMail(env, {
        to: f.email, kind: "follower_end", billId: bill.id, fromName: bill.serial,
        subject: lost ? `${bill.serial} has been declared lost` : `${bill.serial}: the end`,
        heading: lost ? "Pour one out." : "The end.",
        paragraphs: lost ? [bill.eulogy ?? ""] : [`My creator wrote the finale. ${bill.hop_count} hops, ${bill.word_count} words, all by strangers.`],
        quote: [tail, bill.finale_text].filter(Boolean).join(" "),
        quoteLabel: lost && bill.finale_by === "bill" ? "How it ends (the last line is mine; my creator never came back)" : "How it ends",
        button: { label: "Read the whole story", url }, unsubscribeUrl,
      });
    }
  }
}
