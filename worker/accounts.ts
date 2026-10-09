// Optional accounts, no passwords. Signing in is a six-digit code (or a link) emailed through
// Cloudflare Email Sending. Playing never needs an account: everything a dashboard shows is
// found by participant id, so it includes whatever someone did as "a stranger" before signing up.

import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { Dashboard, DashboardHop, FollowPreference, Me } from "../shared/types";
import { checkPenName, maskEmail } from "../shared/words";
import { type BillRow, type UserRow, getBillBySerial, getPass, personalityOf } from "./db";
import { sendMail } from "./email";
import { UserError, setFollowPreference, validateEmail } from "./engine";
import { ip, limit, readBody } from "./http";
import { CODE_TTL, OFFER_TTL, challengeLimit, createChallenge, penNameFor } from "./challenges";
import { DIRTY_MESSAGE, isClean } from "./moderation";
import { DAY, capToken, checkCap, newId, now, participantId, placeLabel, randomToken, sameString, sha256Hex } from "./util";
import { passFromTicket, summaries } from "./views";

const SESSION_COOKIE = "fwp_session";
const SESSION_TTL = 30 * DAY;
const MAX_TRIES = 5;
/** Wrong codes per address per day, across all its challenges. The link still works past it. */
const MAX_DAILY_FAILURES = 10;

type Ctx = Context<{ Bindings: Env }>;

export const meOf = (u: UserRow): Me => ({ email: u.email, handle: u.handle, isAdmin: !!u.is_admin, createdAt: u.created_at });

/** The signed-in account, or null. A cross-site write never counts as signed in. */
export async function currentUser(c: Ctx): Promise<UserRow | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return null;
  }
  const id = await sha256Hex(token);
  const row = await c.env.DB.prepare("SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?")
    .bind(id, now()).first<UserRow & { session_expires: number }>();
  if (!row) return null;
  // Sliding expiry: anyone who comes back within a month stays signed in.
  if (row.session_expires - now() < SESSION_TTL / 2) {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(now() + SESSION_TTL, id),
      c.env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(now(), row.id),
    ]);
    setSessionCookie(c, token);
  }
  const { session_expires: _, ...user } = row;
  return user;
}

async function requireUser(c: Ctx): Promise<UserRow> {
  const user = await currentUser(c);
  if (!user) throw new UserError("Sign in first.", 401);
  return user;
}

function setSessionCookie(c: Ctx, token: string) {
  setCookie(c, SESSION_COOKIE, token, { path: "/", httpOnly: true, sameSite: "Lax", secure: new URL(c.req.url).protocol === "https:", maxAge: SESSION_TTL / 1000 });
}

/** Only same-site paths survive the round trip through an email. */
const safeNext = (next: string | null | undefined) => (next && /^\/(?![/\\])/.test(next) && next.length <= 200 ? next : null);

/** Hops this person already signed with the pen name they just claimed get its ✓. Names never change. */
const markSignatures = (env: Env, user: UserRow, handle: string) =>
  env.DB.prepare("UPDATE hops SET pen_verified = 1 WHERE writer_pid = ? AND pen_name = ? COLLATE NOCASE AND pen_verified = 0").bind(user.pid, handle).run();

export async function upsertUser(env: Env, emailIn: string): Promise<UserRow> {
  const email = validateEmail(emailIn);
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, email, pid, created_at) VALUES (?,?,?,?)")
    .bind(newId(), email, await participantId(env, email), now()).run();
  return (await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>())!;
}

// ====================================================================== the emailed code

/**
 * Email a code and a link. With a pen name it's an account offer: the same proof creates the
 * account and claims the name, and it lasts a week, since nobody is necessarily waiting on it.
 */
export async function startSignIn(env: Env, emailIn: string, next: string | null, handle: string | null = null, waitBetween = true): Promise<{ challenge: string; sentTo: string }> {
  const email = validateEmail(emailIn, "Your email");
  const limited = await challengeLimit(env, email, waitBetween);
  if (limited) throw new UserError(limited, 429);
  const ch = await createChallenge(env, email, { withCode: true, handle, next, ttl: handle ? OFFER_TTL : CODE_TTL });
  const code = ch.code!;
  const lasts = handle ? "for the next 7 days" : "for the next 15 minutes";
  await sendMail(env, {
    deliveryKey: `signin:${ch.id}`,
    to: email,
    kind: "signin",
    subject: `${code} is your Four Word Pass code`,
    preheader: handle ? `Finish your account and make “${handle}” yours.` : "Enter it on the site, or tap the button. It works once, for 15 minutes.",
    heading: handle ? `Make it yours, ${handle}.` : "Your sign-in code",
    paragraphs: handle
      ? [`You asked to create a Four Word Pass account with the pen name “${handle}”. Tap the button, or enter this code where you asked. It works once, ${lasts}. Once the pen name is yours, nobody else can sign with it.`]
      : [`Enter this code where you asked for it, or tap the button below. It works once, ${lasts}.`],
    code: `${code.slice(0, 3)} ${code.slice(3)}`,
    button: { label: handle ? "Create my account" : "Sign in to Four Word Pass", url: ch.url },
    footer: "Didn't ask for this? Ignore it. Nobody gets in without the code.",
  });
  return { challenge: ch.id, sentTo: maskEmail(email) };
}

export async function verifySignIn(env: Env, challengeId: string, proof: { code?: string; link?: string }): Promise<{ user: UserRow; sessionToken: string; penNameTaken: string | null }> {
  const t = now();
  const ch = await env.DB.prepare("SELECT * FROM auth_challenges WHERE id = ?").bind(challengeId).first<{
    id: string; email: string; code_hash: string; link_hash: string; attempts: number; used_at: number | null;
    handle: string | null; follow_id: string | null;
  }>();
  if (!ch) throw new UserError("That sign-in link isn't valid. Send yourself a new code.");
  // Six digits are guessable given enough tries, so wrong codes are capped per address, not just per email sent.
  if (proof.code) {
    const today = await env.DB.prepare("SELECT COALESCE(SUM(failures), 0) AS n FROM auth_challenges WHERE email = ? AND created_at > ?")
      .bind(ch.email, t - DAY).first<{ n: number }>();
    if ((today?.n ?? 0) >= MAX_DAILY_FAILURES) throw new UserError("Too many wrong codes today. Use the button in your email instead.", 429);
  }
  const tried = await env.DB.prepare("UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?")
    .bind(ch.id, t, MAX_TRIES).run();
  if (!tried.meta.changes) {
    throw new UserError(ch.used_at ? "That code was already used. Send yourself a new one." : ch.attempts >= MAX_TRIES ? "Too many tries. Send yourself a new code." : "That code has expired. Send yourself a new one.");
  }
  const ok = proof.code
    ? sameString(ch.code_hash, await capToken(env, "signin", `${ch.id}:${proof.code.replace(/\D/g, "")}`))
    : !!proof.link && sameString(ch.link_hash, await sha256Hex(proof.link));
  if (!ok) {
    await env.DB.prepare("UPDATE auth_challenges SET failures = failures + 1 WHERE id = ?").bind(ch.id).run();
    throw new UserError(ch.attempts + 1 >= MAX_TRIES ? "Too many tries. Send yourself a new code." : "That code doesn't match. Check the email and try again.");
  }
  const used = await env.DB.prepare("UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(t, ch.id).run();
  if (!used.meta.changes) throw new UserError("That code was already used. Send yourself a new one.");

  const user = await upsertUser(env, ch.email);
  await linkHistory(env, user);
  // An offer's pen name is claimed only now that the address is proven. An existing pen name stays.
  let penNameTaken: string | null = null;
  if (ch.handle && !user.handle) {
    try {
      await env.DB.prepare("UPDATE users SET handle = ? WHERE id = ? AND handle IS NULL").bind(ch.handle, user.id).run();
      user.handle = ch.handle;
      await markSignatures(env, user, ch.handle);
    } catch (e) {
      if (!String(e).includes("UNIQUE")) throw e;
      penNameTaken = ch.handle;
    }
  }
  // The follow this offer rode in on: the same tap confirms it, unless they've since opted out.
  if (ch.follow_id) {
    const f = await env.DB.prepare("SELECT bill_id, preference FROM follows WHERE id = ? AND email = ? AND opted_out = 0")
      .bind(ch.follow_id, ch.email).first<{ bill_id: string; preference: FollowPreference }>();
    if (f) await setFollowPreference(env, ch.follow_id, f.bill_id, f.preference);
  }
  const sessionToken = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?,?,?,?)").bind(await sha256Hex(sessionToken), user.id, t + SESSION_TTL, t),
    env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(t, user.id),
  ]);
  return { user, sessionToken, penNameTaken };
}

// ====================================================================== the anonymized log

const PID_COLUMNS = [
  ["bills", "creator_email", "creator_pid"],
  ["passes", "recipient_email", "recipient_pid"],
  ["hops", "writer_email", "writer_pid"],
  ["follows", "email", "pid"],
] as const;

// INDEXED BY pins the partial "_pid_todo" indexes (only rows still waiting). Otherwise the planner
// may pick the plain pid index, which also holds every seeded hop. It errors if the index stops fitting.
const fill = (table: string, email: string, pid: string) =>
  `UPDATE ${table} INDEXED BY ${table}_pid_todo SET ${pid} = ? WHERE ${pid} IS NULL AND ${email} = ?`;

/** Rows from before accounts existed get their participant id at sign-in, in case cron hasn't reached them. */
async function linkHistory(env: Env, user: UserRow) {
  await env.DB.batch(PID_COLUMNS.map(([table, email, pid]) => env.DB.prepare(fill(table, email, pid)).bind(user.pid, user.email)));
}

/** Cron: give older rows their participant id, a few addresses at a time. Reads nothing once it's caught up. */
export async function backfillParticipants(env: Env, perTable = 50) {
  for (const [table, email, pid] of PID_COLUMNS) {
    const { results } = await env.DB.prepare(`SELECT DISTINCT ${email} AS email FROM ${table} INDEXED BY ${table}_pid_todo
      WHERE ${pid} IS NULL AND ${email} IS NOT NULL LIMIT ?`).bind(perTable).all<{ email: string }>();
    if (!results.length) continue;
    await env.DB.batch(await Promise.all(results.map(async (r) =>
      env.DB.prepare(fill(table, email, pid)).bind(await participantId(env, r.email), r.email))));
  }
}

// ====================================================================== what the account can see

export async function dashboard(env: Env, user: UserRow): Promise<Dashboard> {
  const pid = user.pid;
  const mine = "IN (SELECT id FROM passes WHERE recipient_pid = ?)";
  const [stats, write, repass, arriving, started, hops, following] = await Promise.all([
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM hops WHERE writer_pid = ?1 AND status = 'confirmed' AND inherited_from_hop_id IS NULL) AS hops,
         (SELECT COALESCE(SUM(content_words), 0) FROM hops WHERE writer_pid = ?1 AND status = 'confirmed' AND inherited_from_hop_id IS NULL) AS words,
         (SELECT COUNT(*) FROM passes WHERE recipient_pid = ?1 AND status = 'delivered') AS held,
         (SELECT COUNT(*) FROM bills WHERE creator_pid = ?1) AS started,
         (SELECT COUNT(DISTINCT city || ',' || COALESCE(country, '')) FROM hops
           WHERE writer_pid = ?1 AND status = 'confirmed' AND city IS NOT NULL AND inherited_from_hop_id IS NULL) AS places`,
    ).bind(pid).first<Dashboard["stats"]>(),
    summaries(env, `status = 'holding' AND returned_pass_id IS NULL AND holder_pass_id ${mine}`, "holder_since DESC", 50, pid),
    // Sent back to you: as the one who passed it on, or as its creator when the first holder declined.
    summaries(env, `status = 'holding' AND returned_pass_id IS NOT NULL AND (holder_pass_id ${mine} OR (holder_pass_id IS NULL AND creator_pid = ?))`, "holder_since DESC", 50, pid, pid),
    summaries(env, "status = 'in_transit' AND active_pass_id IN (SELECT id FROM passes WHERE recipient_pid = ? AND kind = 'claim' AND status = 'pending')", "created_at DESC", 20, pid),
    summaries(env, "creator_pid = ?", "created_at DESC", 100, pid),
    env.DB.prepare(
      `SELECT h.id, h.idx, h.words, h.city, h.region, h.country, h.pen_name, h.pen_verified, h.stamp_key, h.stamp_status, h.confirmed_at,
              b.serial, b.personality
       FROM hops h JOIN bills b ON b.id = h.bill_id
       WHERE h.writer_pid = ? AND h.status = 'confirmed' AND h.inherited_from_hop_id IS NULL
       ORDER BY h.confirmed_at DESC LIMIT 300`,
    ).bind(pid).all<{
      id: string; idx: number; words: string; city: string | null; region: string | null; country: string | null; pen_name: string | null;
      pen_verified: number; stamp_key: string | null; stamp_status: DashboardHop["stampStatus"]; confirmed_at: number; serial: string; personality: string;
    }>(),
    env.DB.prepare(
      `SELECT f.id, f.preference, b.serial, b.personality, b.status FROM follows f JOIN bills b ON b.id = f.bill_id
       WHERE f.pid = ? AND f.verified = 1 AND f.opted_out = 0 ORDER BY f.created_at DESC LIMIT 200`,
    ).bind(pid).all<{ id: string; preference: FollowPreference; serial: string; personality: string; status: BillRow["status"] }>(),
  ]);
  return {
    me: meOf(user),
    stats: stats ?? { hops: 0, words: 0, held: 0, started: 0, places: 0 },
    inHand: [
      ...write.map((b) => ({ ...b, action: "write" as const })),
      ...repass.map((b) => ({ ...b, action: "repass" as const })),
      ...arriving.map((b) => ({ ...b, action: "arriving" as const })),
    ],
    started,
    hops: hops.results.map((h) => ({
      serial: h.serial,
      personaName: personalityOf(h).name,
      idx: h.idx,
      words: h.words,
      place: placeLabel(h),
      penName: h.pen_name,
      penVerified: !!h.pen_verified,
      stampUrl: h.stamp_key ? `/api/stamps/${h.stamp_key.replace(/^stamps\//, "")}` : null,
      stampStatus: h.stamp_status,
      confirmedAt: h.confirmed_at,
      opening: h.id.startsWith("opening:"),
    })),
    following: following.results.map((f) => ({ id: f.id, serial: f.serial, personaName: personalityOf(f).name, status: f.status, preference: f.preference })),
  };
}

/** The holder and creator keys a signed-in account is entitled to, so a lost email never strands a buck. */
export async function keysFor(env: Env, user: UserRow, bill: BillRow): Promise<{ t: string | null; c: string | null }> {
  const isMine = async (passId: string | null) => {
    const pass = passId ? await getPass(env, passId) : null;
    return pass && (pass.recipient_pid ?? (await participantId(env, pass.recipient_email))) === user.pid ? pass : null;
  };
  let t: string | null = null;
  const holding = (bill.status === "holding" || bill.status === "in_transit") && (await isMine(bill.holder_pass_id));
  if (holding) t = await capToken(env, "holder", holding.id);
  else if (bill.status === "in_transit") {
    // A claim whose dollar is still on its way.
    const arriving = await isMine(bill.active_pass_id);
    if (arriving?.kind === "claim" && arriving.status === "pending") t = await capToken(env, "holder", arriving.id);
  }
  const creator = bill.creator_pid ? bill.creator_pid === user.pid : bill.creator_email === user.email;
  return { t, c: creator ? await capToken(env, "creator", bill.id) : null };
}

// ====================================================================== routes (mounted at /api)

export const accounts = new Hono<{ Bindings: Env }>();

/** Email a code to an address you type, or to the one a holder or creator link was sent to. */
accounts.post("/auth/start", async (c) => {
  await limit(c.env.RL_WRITE, `auth:${ip(c.req.raw)}`);
  const body = await readBody(c, z.object({
    email: z.string().max(254).optional(), serial: z.string().max(32).optional(), ticket: z.string().max(200).optional(),
    c: z.string().max(256).optional(), next: z.string().max(300).nullish(), penName: z.string().max(64).optional(),
  }));
  let email = body.email;
  if (!email && body.serial) {
    const bill = await getBillBySerial(c.env, body.serial);
    if (bill && body.ticket) email = (await passFromTicket(c.env, bill, body.ticket))?.recipient_email;
    else if (bill && body.c && (await checkCap(c.env, "creator", bill.id, body.c))) email = bill.creator_email ?? undefined;
    if (!email) throw new UserError("That link has expired. Enter your email instead.", 403);
  }
  // A pen name makes this an account offer; it's checked now and claimed once the address is proven.
  const pen = body.penName?.trim() ? await penNameFor(c.env, body.penName, validateEmail(email, "Your email")) : null;
  if (pen && "error" in pen) throw new UserError(pen.error, 409);
  return c.json(await startSignIn(c.env, email ?? "", safeNext(body.next), pen?.name ?? null));
});

accounts.post("/auth/verify", async (c) => {
  await limit(c.env.RL_WRITE, `verify:${ip(c.req.raw)}`);
  const body = await readBody(c, z.object({ challenge: z.string().min(1).max(64), code: z.string().max(16).optional(), link: z.string().max(128).optional() }));
  const { user, sessionToken, penNameTaken } = await verifySignIn(c.env, body.challenge, body);
  setSessionCookie(c, sessionToken);
  return c.json({ me: meOf(user), penNameTaken });
});

accounts.post("/auth/signout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: new URL(c.req.url).protocol === "https:" });
  return c.json({ ok: true });
});

accounts.get("/me", async (c) => {
  const user = await currentUser(c);
  return c.json({ me: user ? meOf(user) : null });
});

/** Claim a pen name. Once it's yours, nobody else can sign with it. */
accounts.post("/me/handle", async (c) => {
  const user = await requireUser(c);
  await limit(c.env.RL_WRITE, `handle:${user.id}`);
  const check = checkPenName((await readBody(c, z.object({ handle: z.string().max(64) }))).handle);
  if (!check.ok) throw new UserError(check.error!);
  if (!isClean(check.name)) throw new UserError(DIRTY_MESSAGE);
  try {
    await c.env.DB.prepare("UPDATE users SET handle = ? WHERE id = ?").bind(check.name, user.id).run();
    await markSignatures(c.env, user, check.name);
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new UserError("That pen name is taken. Try another.", 409);
    throw e;
  }
  return c.json({ me: meOf({ ...user, handle: check.name }) });
});

accounts.get("/me/dashboard", async (c) => c.json(await dashboard(c.env, await requireUser(c))));

accounts.get("/me/keys/:serial", async (c) => {
  const user = await currentUser(c);
  const bill = user ? await getBillBySerial(c.env, c.req.param("serial")) : null;
  return c.json(user && bill ? await keysFor(c.env, user, bill) : { t: null, c: null });
});

accounts.post("/me/follows/:id", async (c) => {
  const user = await requireUser(c);
  const { preference } = await readBody(c, z.object({ preference: z.enum(["every_hop", "on_end", "unfollow"]) }));
  const row = await c.env.DB.prepare("SELECT bill_id FROM follows WHERE id = ? AND pid = ?").bind(c.req.param("id"), user.pid).first<{ bill_id: string }>();
  if (!row) throw new UserError("You don't follow that one.", 404);
  await setFollowPreference(c.env, c.req.param("id"), row.bill_id, preference);
  return c.json({ ok: true });
});

/** Is a pen name claimed? Checked before checkout, since a paid release can't fail over a name. */
accounts.get("/pen-names/:name", async (c) => {
  const row = await c.env.DB.prepare("SELECT pid FROM users WHERE handle = ? COLLATE NOCASE").bind(c.req.param("name").trim()).first<{ pid: string }>();
  const user = row ? await currentUser(c) : null;
  return c.json({ claimed: !!row, yours: !!row && row.pid === user?.pid });
});
