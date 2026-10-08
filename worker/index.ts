import { Hono } from "hono";
import type { AppConfig, FollowPreference, HomeData } from "../shared/types";
import { checkFourWords, normalizeWords } from "../shared/words";
import { admin } from "./admin";
import { openBooks } from "./books";
import { receiveEmail } from "./inbox";
import * as ai from "./ai";
import { runCron } from "./cron";
import { type PassRow, getBillBySerial, getPass, storyTail } from "./db";
import * as engine from "./engine";
import { UserError } from "./engine";
import { createOrder, paypalMode, parsePayoutEvent, verifyWebhook } from "./paypal";
import { checkCap, newId, now, placeFromRequest, placeLabel } from "./util";
import { SUGGESTIONS_PER_HOLDER, creatorView, holderView, publicBill, summaries } from "./views";
import { servePage, serveSitemap } from "./seo";

const app = new Hono<{ Bindings: Env }>();

const ctxOf = (c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }) => ({ waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p) });
const ip = (req: Request) => req.headers.get("cf-connecting-ip") ?? "local";

async function limit(binding: RateLimit, key: string) {
  const { success } = await binding.limit({ key });
  if (!success) throw new UserError("Slow down a little. The buck isn't going anywhere.", 429);
}

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
  const mode = paypalMode(c.env);
  const place = placeFromRequest(c.req.raw);
  return c.json<AppConfig & { place: string | null }>({
    paypalMode: mode,
    paypalClientId: mode === "sandbox" ? c.env.PAYPAL_CLIENT_ID : null,
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
  return c.json(await publicBill(c.env, bill));
});

/** Cheap version check for live pages. */
app.get("/api/bills/:serial/v", async (c) => {
  const row = await c.env.DB.prepare("SELECT version FROM bills WHERE serial = ?").bind(c.req.param("serial").toUpperCase()).first<{ version: number }>();
  return c.json({ v: row?.version ?? -1 });
});

app.get("/api/bills/:serial/holder", async (c) => {
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) return c.json({ state: "invalid" });
  return c.json(await holderView(c.env, c.req.raw, bill, c.req.query("t") ?? ""));
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
  const { purpose } = await c.req.json<{ purpose: "mint" | "fork" }>();
  return c.json({ orderId: await createOrder(c.env, purpose === "fork" ? "fork" : "mint") });
});

async function checkedWords(env: Env, words: string) {
  const check = checkFourWords(normalizeWords(words ?? ""));
  if (!check.ok) {
    await env.DB.prepare("INSERT INTO rejections (id, words, reason, created_at) VALUES (?,?,?,?)").bind(newId(), String(words ?? "").slice(0, 200), check.error!, now()).run();
    throw new UserError(check.error!);
  }
}

app.post("/api/bills", async (c) => {
  await limit(c.env.RL_WRITE, `mint:${ip(c.req.raw)}`);
  const body = await c.req.json<engine.MintInput>();
  await checkedWords(c.env, body.words);
  const out = await engine.mintBill(c.env, ctxOf(c), placeFromRequest(c.req.raw), { ...body, fork: undefined });
  return c.json(out);
});

app.post("/api/bills/:serial/fork", async (c) => {
  await limit(c.env.RL_WRITE, `mint:${ip(c.req.raw)}`);
  const body = await c.req.json<engine.MintInput & { atHop: number }>();
  await checkedWords(c.env, body.words);
  const out = await engine.mintBill(c.env, ctxOf(c), placeFromRequest(c.req.raw), {
    ...body,
    fork: { parentSerial: c.req.param("serial").toUpperCase(), atHop: Number(body.atHop) },
  });
  return c.json(out);
});

app.post("/api/bills/:serial/contribute", async (c) => {
  await limit(c.env.RL_WRITE, `contribute:${ip(c.req.raw)}`);
  const body = await c.req.json<engine.ContributeInput & { t: string }>();
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) throw new UserError("No bill by that serial.", 404);
  if (!(await checkCap(c.env, "holder", bill.holder_pass_id, body.t))) throw new UserError("This buck has moved on.", 403);
  await checkedWords(c.env, body.words);
  return c.json(await engine.contribute(c.env, ctxOf(c), placeFromRequest(c.req.raw), bill, body));
});

app.post("/api/bills/:serial/claim", async (c) => {
  await limit(c.env.RL_WRITE, `claim:${ip(c.req.raw)}`);
  const { email } = await c.req.json<{ email: string }>();
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) throw new UserError("No bill by that serial.", 404);
  return c.json(await engine.claimFromWild(c.env, ctxOf(c), bill, email));
});

app.post("/api/bills/:serial/suggest", async (c) => {
  await limit(c.env.RL_AI, `suggest:${ip(c.req.raw)}`);
  const body = await c.req.json<{ t?: string; c?: string; mode?: "finale" }>();
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
  const body = await c.req.json<{ c: string; words: string }>();
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) throw new UserError("No bill by that serial.", 404);
  if (!(await checkCap(c.env, "creator", bill.id, body.c))) throw new UserError("Only the creator can end this story.", 403);
  await engine.writeCreatorFinale(c.env, ctxOf(c), bill, body.words);
  return c.json({ ok: true });
});

app.post("/api/bills/:serial/follow", async (c) => {
  await limit(c.env.RL_WRITE, `follow:${ip(c.req.raw)}`);
  const body = await c.req.json<{ email: string; preference: FollowPreference }>();
  const bill = await getBillBySerial(c.env, c.req.param("serial"));
  if (!bill) throw new UserError("No bill by that serial.", 404);
  await engine.follow(c.env, bill, body.email, body.preference === "every_hop" ? "every_hop" : "on_end");
  return c.json({ ok: true });
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
  const row = await c.env.DB.prepare("SELECT f.preference, b.serial FROM follows f JOIN bills b ON b.id = f.bill_id WHERE f.id = ?").bind(id).first<{ preference: string; serial: string }>();
  return c.json(row ?? { preference: null, serial: null });
});

app.post("/api/follows/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ t: string; preference: FollowPreference | "unfollow" }>();
  if (!(await checkCap(c.env, "follow", id, body.t))) throw new UserError("That link has expired.", 403);
  const row = await c.env.DB.prepare("SELECT bill_id FROM follows WHERE id = ?").bind(id).first<{ bill_id: string }>();
  if (!row) return c.json({ ok: true });
  await c.env.DB.batch([
    body.preference === "unfollow"
      ? c.env.DB.prepare("DELETE FROM follows WHERE id = ?").bind(id)
      : c.env.DB.prepare("UPDATE follows SET preference = ? WHERE id = ?").bind(body.preference === "every_hop" ? "every_hop" : "on_end", id),
    c.env.DB.prepare("UPDATE bills SET follower_count = (SELECT COUNT(*) FROM follows WHERE bill_id = ?1), version = version + 1 WHERE id = ?1").bind(row.bill_id),
  ]);
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
  if (pass && parsed) await engine.applyPayoutState(c.env, ctxOf(c), pass, parsed.state);
  return c.json({ ok: true });
});

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
