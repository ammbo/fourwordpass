import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AppConfig, HomeData } from "../shared/types";
import { checkFourWords, normalizeWords } from "../shared/words";
import { accounts, currentUser, startSignIn } from "./accounts";
import { penNameFor } from "./challenges";
import { admin } from "./admin";
import { openBooks } from "./books";
import { receiveEmail } from "./inbox";
import * as ai from "./ai";
import { runCron } from "./cron";
import { type PassRow, getBillBySerial, getPass, storyTail } from "./db";
import * as engine from "./engine";
import { UserError } from "./engine";
import { ctxOf, ip, limit, readBody } from "./http";
import { createOrder, PayPalError, paypalMode, paypalCredentials, parsePayoutEvent, verifyWebhook } from "./paypal";
import { checkCap, newId, now, placeFromRequest, placeLabel, randomToken, recoveryHash } from "./util";
import { SUGGESTIONS_PER_HOLDER, creatorView, holderView, passFromTicket, publicBill, summaries } from "./views";
import { servePage, serveSitemap } from "./seo";
import { parseStoryCursor } from "./history";

const app = new Hono<{ Bindings: Env }>();

const token = z.string().min(1).max(256);
const emailSchema = z.string().trim().min(3).max(254);
// Signed in, the creator email comes from the account. `free` is honored only for a signed-in admin.
const mintSchema = z.object({
  orderId: z.string().min(1).max(128).optional(), recoveryKey: z.string().min(32).max(128).optional(), free: z.boolean().optional(),
  creatorEmail: emailSchema.optional(),
  words: z.string().max(90), theme: z.string().max(140).nullish(), goal: z.number().int().min(2).max(100_000).nullish(),
  firstRecipient: emailSchema.nullish(), penName: z.string().max(24).nullish(), showCity: z.boolean().optional(),
  createAccount: z.boolean().optional(),
});
app.use("/api/*", bodyLimit({maxSize: 32_768, onError: c => c.json({error: "That request is too large."},413)}));

// "Four" is a homonym. Every spelling someone might hear lands on the real site.
const CANONICAL_HOST = "fourwordpass.com";
const ALIAS_HOSTS = new Set(["www.fourwordpass.com", "forwordpass.com", "www.forwordpass.com", "forewordpass.com", "www.forewordpass.com", "forewardpass.com", "www.forewardpass.com"]);
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  if (ALIAS_HOSTS.has(url.hostname) || (url.hostname === CANONICAL_HOST && url.protocol !== "https:")) return c.redirect(`https://${CANONICAL_HOST}${url.pathname}${url.search}`, 301);
  await next();
  // Also apply to raw asset/HTML Responses returned by downstream handlers.
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
});

app.onError((err, c) => {
  if (err instanceof UserError) return c.json({ error: err.message }, err.status as 400);
  if (err instanceof PayPalError && err.status === 503) return c.json({error: err.message},503);
  console.error(err);
  return c.json({ error: "Something went wrong. The buck is looking into it." }, 500);
});

app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
});

// ------------------------------------------------------------------ read

app.get("/api/config", (c) => {
  let mode;
  try { mode = paypalMode(c.env); } catch { return c.json({error: "Checkout is unavailable because PayPal is not configured."},503); }
  const place = placeFromRequest(c.req.raw);
  return c.json<AppConfig & { place: string | null }>({
    paypalMode: mode,
    paypalClientId: mode === "mock" ? null : paypalCredentials(c.env).clientId!,
    place: place.city || place.country ? placeLabel(place) : null,
  });
});

app.get("/api/home", async (c) => {
  const env = c.env;
  const [stats, cities, featured, recent, wild] = await Promise.all([
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM bills WHERE status IN ('holding','in_transit','wild')) AS traveling,
         (SELECT COALESCE(SUM(content_words), 0) FROM hops WHERE status = 'confirmed' AND inherited_from_hop_id IS NULL) AS words,
         (SELECT COUNT(*) FROM hops WHERE status = 'confirmed' AND inherited_from_hop_id IS NULL) AS hops`,
    ).first<{ traveling: number; words: number; hops: number }>(),
    env.DB.prepare("SELECT COUNT(DISTINCT city || ',' || COALESCE(country,'')) AS n FROM hops WHERE status = 'confirmed' AND city IS NOT NULL AND inherited_from_hop_id IS NULL").first<{ n: number }>(),
    summaries(env, "featured = 1", "hop_count DESC", 6),
    summaries(env, "featured = 0 AND status IN ('holding','in_transit','wild','complete','eulogized')", "version DESC, created_at DESC", 6),
    summaries(env, "status = 'wild'", "follower_count DESC, wild_since DESC", 4),
  ]);
  return c.json<HomeData>({
    stats: { traveling: stats?.traveling ?? 0, words: stats?.words ?? 0, hops: stats?.hops ?? 0, cities: cities?.n ?? 0 },
    featured,
    recent,
    wild,
  });
});

app.get("/api/wild", async (c) => {
  // Newest and most-followed first, so spam sinks.
  return c.json(await summaries(c.env, "status = 'wild'", "featured DESC, follower_count DESC, wild_since DESC", 60));
});

app.get("/api/books", async (c) => c.json(await openBooks(c.env)));

app.get("/api/bills/:serial", async (c) => {
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) return c.json({ error: "No bill by that serial." }, 404);
  let cursor;
  try { cursor = parseStoryCursor(new URL(c.req.url).searchParams); }
  catch (e) { throw new UserError((e as Error).message); }
  return c.json(await publicBill(c.env, bill, cursor));
});

/** Cheap version check for live pages. */
app.get("/api/bills/:serial/v", async (c) => {
  const row = await c.env.DB.prepare("SELECT version FROM bills WHERE serial = ?").bind(c.req.param("serial").toUpperCase()).first<{ version: number }>();
  return c.json({ v: row?.version ?? -1 });
});

app.get("/api/bills/:serial/holder", async (c) => {
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) return c.json({ state: "invalid" });
  return c.json(await holderView(c.env, c.req.raw, bill, c.req.query("t") ?? "", await currentUser(c)));
});

app.get("/api/bills/:serial/creator", async (c) => {
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) return c.json({ valid: false });
  return c.json(await creatorView(c.env, bill, c.req.query("c") ?? ""));
});

app.get("/api/stamps/:key", async (c) => {
  const obj = await c.env.STAMPS.get(`stamps/${c.req.param("key")}`);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
  });
});

// ------------------------------------------------------------------ write

app.post("/api/checkout", async (c) => {
  await limit(c.env.RL_WRITE, `checkout:${ip(c.req.raw)}`);
  const { purpose, recoveryKey } = await readBody(c, z.object({purpose: z.enum(["mint","fork"]), recoveryKey: z.string().min(32).max(128)}));
  const orderId = await createOrder(c.env,purpose);
  await c.env.DB.prepare("INSERT INTO checkout_orders (order_id,recovery_hash,paypal_mode,purpose,created_at) VALUES (?,?,?,?,?)")
    .bind(orderId,await recoveryHash(recoveryKey),paypalMode(c.env),purpose,now()).run();
  return c.json({orderId});
});

async function checkedWords(env: Env, words: string) {
  const check = checkFourWords(normalizeWords(words ?? ""));
  if (!check.ok) {
    await env.DB.prepare("INSERT INTO rejections (id, words, reason, created_at) VALUES (?,?,?,?)").bind(newId(), String(words ?? "").slice(0, 200), check.error!, now()).run();
    throw new UserError(check.error!);
  }
}

/** A paid release carries its checkout. A signed-in admin can release without one: the platform funds it. */
async function mintInput(c: Parameters<typeof currentUser>[0], body: z.infer<typeof mintSchema>, fork?: engine.MintInput["fork"]): Promise<engine.MintInput> {
  const { free, orderId, recoveryKey, createAccount, ...rest } = body;
  const user = await currentUser(c);
  // Signed in, there's already an account; otherwise the creator-key email can offer one.
  const draft = { ...rest, ...(createAccount && !user ? { createAccount: true } : {}) };
  const creatorEmail = draft.creatorEmail ?? user?.email;
  if (!creatorEmail) throw new UserError("We need your email for your creator key.");
  if (free) {
    if (!user?.is_admin) throw new UserError("Only an admin can release a buck without checkout.", 403);
    return { ...draft, creatorEmail, orderId: `COMP-${newId()}`, recoveryKey: randomToken(), fork, compedBy: user.id };
  }
  if (!orderId || !recoveryKey) throw new UserError("Finish checkout first.", 402);
  return { orderId, recoveryKey, ...draft, creatorEmail, fork };
}

app.post("/api/bills", async (c) => {
  await limit(c.env.RL_WRITE, `mint:${ip(c.req.raw)}`);
  const body = await readBody(c, mintSchema);
  await checkedWords(c.env, body.words);
  return c.json(await engine.mintBill(c.env, ctxOf(c), placeFromRequest(c.req.raw), await mintInput(c, body)));
});

app.post("/api/bills/:serial/fork", async (c) => {
  await limit(c.env.RL_WRITE, `mint:${ip(c.req.raw)}`);
  const { atHop, ...body } = await readBody(c, mintSchema.extend({atHop: z.number().int().min(1)}));
  await checkedWords(c.env, body.words);
  const fork = { parentSerial: c.req.param("serial").toUpperCase(), atHop: Number(atHop) };
  return c.json(await engine.mintBill(c.env, ctxOf(c), placeFromRequest(c.req.raw), await mintInput(c, body, fork)));
});

app.post("/api/bills/:serial/contribute", async (c) => {
  await limit(c.env.RL_WRITE, `contribute:${ip(c.req.raw)}`);
  const body = await readBody(c, z.object({t: token, words: z.string().max(90), next: emailSchema.nullable(), note: z.string().max(140).nullish(), penName: z.string().max(24).nullish(), showCity: z.boolean().optional(), aiAssisted: z.boolean().optional()}));
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) throw new UserError("No bill by that serial.", 404);
  if (!(await checkCap(c.env, "holder", bill.holder_pass_id, body.t))) throw new UserError("This buck has moved on.", 403);
  await checkedWords(c.env, body.words);
  return c.json(await engine.contribute(c.env, ctxOf(c), placeFromRequest(c.req.raw), bill, body));
});

/** Not for you: the bill goes back to whoever passed it to you, or back to the wild if you claimed it. */
app.post("/api/bills/:serial/decline", async (c) => {
  await limit(c.env.RL_WRITE, `decline:${ip(c.req.raw)}`);
  const body = await readBody(c, z.object({t: token}));
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) throw new UserError("No bill by that serial.", 404);
  if (!(await checkCap(c.env, "holder", bill.holder_pass_id, body.t))) throw new UserError("This buck has moved on.", 403);
  return c.json(await engine.declineBill(c.env, ctxOf(c), bill));
});

/** A bill that came back: its holder, or its creator when it was the first hand-off, picks someone new. */
app.post("/api/bills/:serial/repass", async (c) => {
  await limit(c.env.RL_WRITE, `contribute:${ip(c.req.raw)}`);
  const body = await readBody(c, z.object({t: token.optional(), c: token.optional(), next: emailSchema.nullable()}));
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) throw new UserError("No bill by that serial.", 404);
  const allowed = bill.holder_pass_id
    ? await checkCap(c.env, "holder", bill.holder_pass_id, body.t)
    : await checkCap(c.env, "creator", bill.id, body.c);
  if (!allowed) throw new UserError("This buck has moved on.", 403);
  return c.json(await engine.repass(c.env, ctxOf(c), bill, body.next));
});

app.post("/api/bills/:serial/claim", async (c) => {
  await limit(c.env.RL_WRITE, `claim:${ip(c.req.raw)}`);
  const { email, penName } = await readBody(c, z.object({email: emailSchema.optional(), penName: z.string().max(64).optional()}));
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) throw new UserError("No bill by that serial.", 404);
  const user = await currentUser(c);
  const claimer = email ?? user?.email ?? "";
  // A pen name asks for an account. It's checked before claiming; the account waits for the emailed code or link.
  const pen = !user && penName?.trim() ? await penNameFor(c.env, penName, engine.validateEmail(claimer, "Your email")) : null;
  if (pen && "error" in pen) throw new UserError(pen.error, 409);
  const claimed = await engine.claimFromWild(c.env, ctxOf(c), bill, claimer);
  const account = pen ? await startSignIn(c.env, claimer, `/b/${bill.serial}`, pen.name, false).catch(() => null) : null;
  return c.json({ ...claimed, account: account && pen ? { ...account, penName: pen.name } : null });
});

app.post("/api/bills/:serial/suggest", async (c) => {
  await limit(c.env.RL_AI, `suggest:${ip(c.req.raw)}`);
  const body = await readBody(c, z.object({t: token.optional(), c: token.optional(), mode: z.literal("finale").optional()}));
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) throw new UserError("No bill by that serial.", 404);
  const tail = await storyTail(c.env, bill.id, body.mode === "finale" ? 160 : 50);

  if (body.mode === "finale") {
    if (!(await checkCap(c.env, "creator", bill.id, body.c))) throw new UserError("Only the creator can end this story.", 403);
    return c.json({ options: await ai.suggestFinale(c.env, { theme: bill.theme, storyTail: tail, hopCount: bill.hop_count, goal: bill.goal_hops }) });
  }
  if (bill.status !== "holding" || !(await checkCap(c.env, "holder", bill.holder_pass_id, body.t))) throw new UserError("This buck has moved on.", 403);
  // Suggestions are rationed per holder: cost control, and the words should mostly be yours.
  const used = await c.env.DB.prepare("UPDATE passes SET suggest_count = suggest_count + 1 WHERE id = ? AND suggest_count < ?")
    .bind(bill.holder_pass_id, SUGGESTIONS_PER_HOLDER)
    .run();
  if (!used.meta.changes) throw new UserError("That's all the help the buck can give. The rest is up to you.", 429);
  const options = await ai.suggestFour(c.env, { theme: bill.theme, storyTail: tail });
  const pass = (await getPass(c.env, bill.holder_pass_id!)) as PassRow;
  return c.json({ options, left: Math.max(0, SUGGESTIONS_PER_HOLDER - pass.suggest_count) });
});

app.post("/api/bills/:serial/finale", async (c) => {
  await limit(c.env.RL_WRITE, `finale:${ip(c.req.raw)}`);
  const body = await readBody(c, z.object({c: token, words: z.string().max(200)}));
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) throw new UserError("No bill by that serial.", 404);
  if (!(await checkCap(c.env, "creator", bill.id, body.c))) throw new UserError("Only the creator can end this story.", 403);
  await engine.writeCreatorFinale(c.env, ctxOf(c), bill, body.words);
  return c.json({ ok: true });
});

/**
 * A typed email gets a confirmation link. A proven address follows at once: the signed-in
 * account's, or the one a holder's ticket says this buck was passed to.
 */
app.post("/api/bills/:serial/follow", async (c) => {
  await limit(c.env.RL_WRITE, `follow:${ip(c.req.raw)}`);
  const body = await readBody(c, z.object({email: emailSchema.optional(), ticket: z.string().max(200).optional(), preference: z.enum(["every_hop","on_end"]), penName: z.string().max(64).optional()}));
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) throw new UserError("No bill by that serial.", 404);
  const user = await currentUser(c);
  const typed = body.email?.toLowerCase();
  if (typed && typed !== user?.email) {
    // A pen name asks for an account too: the confirmation email offers it, and one tap does both.
    const pen = !user && body.penName?.trim() ? await penNameFor(c.env, body.penName, typed) : null;
    if (pen && "error" in pen) throw new UserError(pen.error, 409);
    const { offered } = await engine.follow(c.env, bill, typed, body.preference, pen?.name ?? null);
    // No confirmation went out (already sent recently, or opted out), so the offer travels on its own.
    const account = pen && !offered ? !!(await startSignIn(c.env, typed, `/b/${bill.serial}`, pen.name, false).catch(() => null)) : offered;
    return c.json({ ok: true, verified: false, account });
  }
  const proven = typed ?? (body.ticket ? (await passFromTicket(c.env, bill, body.ticket))?.recipient_email : user?.email);
  if (!proven) throw new UserError(body.ticket ? "That link has expired. Enter your email instead." : "Enter your email to follow.", 403);
  await engine.followVerified(c.env, bill, proven, body.preference);
  return c.json({ ok: true, verified: true });
});

/** "I only got PayPal's email." Re-sends the holder link to whoever holds it. Reveals nothing. */
app.post("/api/bills/:serial/resend", async (c) => {
  await limit(c.env.RL_WRITE, `resend:${ip(c.req.raw)}`);
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (bill) c.executionCtx.waitUntil(engine.resendHolderLink(c.env, bill));
  return c.json({ ok: true });
});

app.get("/api/follows/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await checkCap(c.env, "follow", id, c.req.query("t")))) throw new UserError("That link has expired.", 403);
  const row = await c.env.DB.prepare("SELECT f.preference, f.verified, b.serial FROM follows f JOIN bills b ON b.id = f.bill_id WHERE f.id = ?").bind(id).first<{ preference: string; verified: number; serial: string }>();
  return c.json(row ?? { preference: null, serial: null });
});

async function setFollow(env: Env, id: string, preference: "every_hop" | "on_end" | "unfollow") {
  const row = await env.DB.prepare("SELECT bill_id FROM follows WHERE id = ?").bind(id).first<{ bill_id: string }>();
  if (row) await engine.setFollowPreference(env, id, row.bill_id, preference);
}

app.post("/api/follows/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readBody(c, z.object({t: token, preference: z.enum(["every_hop","on_end","unfollow"])}));
  if (!(await checkCap(c.env, "follow", id, body.t))) throw new UserError("That link has expired.", 403);
  await setFollow(c.env, id, body.preference);
  return c.json({ ok: true });
});

// RFC 8058 one-click unsubscribe. Mail clients POST here; a GET (link scanners, older clients) only opens the settings page.
app.get("/api/follows/:id/unsubscribe", (c) =>
  c.redirect(`/f/${encodeURIComponent(c.req.param("id"))}?t=${encodeURIComponent(c.req.query("t") ?? "")}`));
app.post("/api/follows/:id/unsubscribe", async (c) => {
  const id = c.req.param("id");
  if (!(await checkCap(c.env, "follow", id, c.req.query("t")))) throw new UserError("That link has expired.", 403);
  await setFollow(c.env, id, "unfollow");
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ PayPal webhook

app.post("/api/webhooks/paypal", async (c) => {
  const raw = await c.req.text();
  if (!(await verifyWebhook(c.env, c.req.raw.headers, raw))) return c.json({ error: "unverified" }, 400);
  const event = JSON.parse(raw);
  const parsed = parsePayoutEvent(event);
  const pass = parsed
    ? ((parsed.passId ? await getPass(c.env, parsed.passId) : null) ??
      (parsed.state.itemId ? await c.env.DB.prepare("SELECT * FROM passes WHERE payout_item_id = ?").bind(parsed.state.itemId).first<PassRow>() : null))
    : null;
  await c.env.DB.prepare("INSERT INTO payout_events (id, pass_id, event_type, paypal_item_id, raw, received_at) VALUES (?,?,?,?,?,?)")
    .bind(newId(), pass?.id ?? null, event.event_type ?? "unknown", parsed?.state.itemId ?? null, raw.slice(0, 20000), now())
    .run();
  if (pass && parsed && pass.paypal_mode === paypalMode(c.env)) await engine.applyPayoutState(c.env, ctxOf(c), pass, parsed.state);
  return c.json({ ok: true });
});

app.route("/api", accounts);
app.route("/api/admin", admin);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// ------------------------------------------------------------------ search and share pages
app.get("/sitemap.xml", (c) => serveSitemap(c.req.path, c.env));
app.get("/sitemap-pages.xml", (c) => serveSitemap(c.req.path, c.env));
app.get("*", async (c) => {
  if (/^\/sitemap-bills-[^/]+\.xml$/.test(c.req.path)) return serveSitemap(c.req.path, c.env);
  // Vite's development modules include extensionless URLs.
  if (c.req.path.startsWith("/@") || c.req.path === "/__vite_ping") return c.env.ASSETS.fetch(c.req.raw);
  // Static files retain their native content types. Missing files must not become SPA HTML.
  if (/\.[a-z0-9]+$/i.test(c.req.path)) {
    const asset = await c.env.ASSETS.fetch(c.req.raw);
    return asset.headers.get("Content-Type")?.includes("text/html") ? c.text("Not found", 404) : asset;
  }
  return servePage(c.req.raw, c.env);
});
app.all("*", (c) => c.text("Method not allowed", 405));

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    await runCron(env, ctx);
  },
  async email(message, env) {
    await receiveEmail(message, env);
  },
} satisfies ExportedHandler<Env>;
