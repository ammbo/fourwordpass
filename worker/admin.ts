// Operator tools. Bearer ADMIN_TOKEN. Used for demo seeding, featuring
// mega-bills, removing abusive hops, and fast-forwarding time for the nag demo.

import { Hono } from "hono";
import { SERIAL_PREFIX } from "../shared/brand";
import * as ai from "./ai";
import { runCron } from "./cron";
import { type BillRow, type HopRow, getBillBySerial, personalityOf, touch } from "./db";
import * as engine from "./engine";
import { HOUR, newId, now, placeLabel } from "./util";

const CITIES: [string, string, string, number, number][] = [
  ["Austin", "TX", "US", 30.3, -97.7], ["Nashville", "TN", "US", 36.2, -86.8], ["Chicago", "IL", "US", 41.9, -87.6],
  ["Brooklyn", "NY", "US", 40.7, -73.9], ["Portland", "OR", "US", 45.5, -122.7], ["Denver", "CO", "US", 39.7, -105],
  ["New Orleans", "LA", "US", 30, -90.1], ["Seattle", "WA", "US", 47.6, -122.3], ["San Francisco", "CA", "US", 37.8, -122.4],
  ["Los Angeles", "CA", "US", 34.1, -118.2], ["Phoenix", "AZ", "US", 33.4, -112.1], ["Minneapolis", "MN", "US", 45, -93.3],
  ["Boston", "MA", "US", 42.4, -71.1], ["Atlanta", "GA", "US", 33.7, -84.4], ["Miami", "FL", "US", 25.8, -80.2],
  ["Salt Lake City", "UT", "US", 40.8, -111.9], ["Kansas City", "MO", "US", 39.1, -94.6], ["Detroit", "MI", "US", 42.3, -83],
  ["Philadelphia", "PA", "US", 40, -75.2], ["Asheville", "NC", "US", 35.6, -82.6], ["Santa Fe", "NM", "US", 35.7, -105.9],
  ["Anchorage", "AK", "US", 61.2, -149.9], ["Honolulu", "HI", "US", 21.3, -157.9], ["Toronto", "ON", "CA", 43.7, -79.4],
  ["Montreal", "QC", "CA", 45.5, -73.6], ["Mexico City", "CMX", "MX", 19.4, -99.1], ["London", "ENG", "GB", 51.5, -0.1],
  ["Dublin", "L", "IE", 53.3, -6.3], ["Lisbon", "11", "PT", 38.7, -9.1], ["Berlin", "BE", "DE", 52.5, 13.4],
];

export const admin = new Hono<{ Bindings: Env }>();

admin.use("*", async (c, next) => {
  if (!c.env.ADMIN_TOKEN || c.req.header("authorization") !== `Bearer ${c.env.ADMIN_TOKEN}`) return c.json({ error: "Not found" }, 404);
  await next();
});

const ctxOf = (c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }) => ({ waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p) });

admin.post("/cron", async (c) => {
  await runCron(c.env, ctxOf(c));
  return c.json({ ok: true });
});

/** Fast-forward a bill's clock so nags and death can be demoed without waiting two weeks. */
admin.post("/age", async (c) => {
  const { serial, hours } = await c.req.json<{ serial: string; hours: number }>();
  const bill = await getBillBySerial(c.env, serial);
  if (!bill) return c.json({ error: "No such bill" }, 404);
  const ms = Math.round(hours * HOUR);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE bills SET holder_since = holder_since - ?, wild_since = wild_since - ? WHERE id = ?").bind(ms, ms, bill.id),
    touch(c.env, bill.id),
  ]);
  await runCron(c.env, ctxOf(c));
  return c.json({ ok: true });
});

admin.post("/feature", async (c) => {
  const { serial, featured } = await c.req.json<{ serial: string; featured: boolean }>();
  await c.env.DB.prepare("UPDATE bills SET featured = ?, version = version + 1 WHERE serial = ?").bind(featured ? 1 : 0, serial).run();
  return c.json({ ok: true });
});

/** Remove an abusive hop. The story recomputes; the payout history stays. */
admin.post("/remove-hop", async (c) => {
  const { serial, idx } = await c.req.json<{ serial: string; idx: number }>();
  const bill = await getBillBySerial(c.env, serial);
  if (!bill) return c.json({ error: "No such bill" }, 404);
  await c.env.DB.batch([
    // The diary may quote the removed words, so its entry goes too.
    c.env.DB.prepare("DELETE FROM diary WHERE hop_id IN (SELECT id FROM hops WHERE bill_id = ? AND idx = ? AND status = 'confirmed')").bind(bill.id, idx),
    c.env.DB.prepare("UPDATE hops SET status = 'removed' WHERE bill_id = ? AND idx = ? AND status = 'confirmed'").bind(bill.id, idx),
    c.env.DB.prepare(
      `UPDATE bills SET hop_count = (SELECT COUNT(*) FROM hops WHERE bill_id = ?1 AND status = 'confirmed'),
         word_count = (SELECT COALESCE(SUM(content_words),0) FROM hops WHERE bill_id = ?1 AND status = 'confirmed'), version = version + 1 WHERE id = ?1`,
    ).bind(bill.id),
  ]);
  return c.json({ ok: true });
});

admin.get("/outbox", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT to_email, kind, subject, status, body_text, error, created_at FROM emails ORDER BY created_at DESC LIMIT 50").all();
  return c.json(results);
});

/** Mail received at @fourwordpass.com. ?to= filters by recipient. */
admin.get("/inbox", async (c) => {
  const to = c.req.query("to")?.toLowerCase();
  const { results } = await c.env.DB.prepare(
    `SELECT id, to_email, from_email, subject, text, links, received_at FROM inbox ${to ? "WHERE to_email = ?" : ""} ORDER BY received_at DESC LIMIT 20`,
  ).bind(...(to ? [to] : [])).all<{ links: string }>();
  return c.json(results.map((r) => ({ ...r, links: JSON.parse(r.links || "[]") })));
});

admin.post("/end", async (c) => {
  const { serial } = await c.req.json<{ serial: string }>();
  const bill = await getBillBySerial(c.env, serial);
  if (!bill) return c.json({ error: "No such bill" }, 404);
  await engine.writeBillsOwnEnding(c.env, bill);
  return c.json({ ok: true });
});

/**
 * Demo seeding. Seeded bills are flagged is_seed and labeled on their pages;
 * their history is simulated (no payouts). They land in the wild, so real
 * people can claim them and keep going.
 */
admin.post("/seed", async (c) => {
  const body = await c.req.json<{ theme: string; hops: number; featured?: boolean; eulogize?: boolean; goal?: number; stamps?: number }>();
  const env = c.env;
  const total = Math.min(Math.max(body.hops, 1), 400);
  const segments: string[] = [];
  for (let attempts = 0; segments.length < total && attempts < Math.ceil(total / 10) + 4; attempts++) {
    const batch = await ai.seedSegments(env, { theme: body.theme, count: Math.min(30, total - segments.length), tail: segments.slice(-10).join(" ") }).catch(() => []);
    segments.push(...batch.slice(0, total - segments.length));
  }
  if (!segments.length) return c.json({ error: "AI produced no valid segments" }, 500);

  const billId = newId();
  const span = 21 * 24 * HOUR;
  const start = now() - span;
  const step = span / (segments.length + 1);
  const offset = Math.floor(Math.random() * CITIES.length);
  const cityAt = (i: number) => CITIES[(offset + i * 7 + Math.floor(i / 5)) % CITIES.length];
  const origin = cityAt(0);
  await env.DB.prepare(
    `INSERT INTO bills (id, seq, serial, status, theme, goal_hops, origin_city, origin_lat, origin_lng, featured, is_seed, wild_since, created_at)
     SELECT ?1, s, ?2 || '-' || printf('%04d', s), 'wild', ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10 FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM bills)`,
  ).bind(billId, SERIAL_PREFIX, body.theme, body.goal ?? null, `${origin[0]}, ${origin[1]}`, origin[3], origin[4], body.featured ? 1 : 0, now(), start).run();
  let bill = (await env.DB.prepare("SELECT * FROM bills WHERE id = ?").bind(billId).first<BillRow>())!;

  const pers = await ai.makePersonality(env, { theme: body.theme, origin: `${origin[0]}, ${origin[1]}`, serial: bill.serial, openingWords: segments[0] });
  const hopIds: string[] = [];
  const stmts = [env.DB.prepare("UPDATE bills SET personality = ? WHERE id = ?").bind(JSON.stringify(pers.personality), billId)];
  stmts.push(env.DB.prepare("INSERT INTO diary (id, bill_id, kind, day_label, text, ai_meta, created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(newId(), billId, "birth", `Day 1 — ${origin[0]}, ${origin[1]}`, pers.birthEntry, JSON.stringify(pers.meta), start));
  segments.forEach((words, i) => {
    const [city, region, country, lat, lng] = cityAt(i);
    const t = Math.round(start + step * (i + 1));
    const id = newId();
    hopIds.push(id);
    stmts.push(env.DB.prepare(
      `INSERT INTO hops (id, bill_id, idx, status, words, content_words, city, region, country, lat, lng, stamp_status, diary_done, followers_notified, created_at, confirmed_at)
       VALUES (?,?,?,'confirmed',?,4,?,?,?,?,?,'none',1,1,?,?)`,
    ).bind(id, billId, i + 1, words, city, region, country, lat, lng, t, t));
  });
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  await env.DB.prepare(
    `UPDATE bills SET hop_count = (SELECT COUNT(*) FROM hops WHERE bill_id = ?1 AND status = 'confirmed'),
       word_count = (SELECT COALESCE(SUM(content_words),0) FROM hops WHERE bill_id = ?1 AND status = 'confirmed') WHERE id = ?1`,
  ).bind(billId).run();
  bill = (await env.DB.prepare("SELECT * FROM bills WHERE id = ?").bind(billId).first<BillRow>())!;

  // A handful of diary entries and illustrated stamps for the most recent hops.
  // Done inline (not waitUntil) so the 30s post-response budget doesn't cut it off.
  await decorate(env, bill, body.stamps ?? 8);
  if (body.eulogize) {
    await env.DB.prepare("UPDATE bills SET wild_since = ? WHERE id = ?").bind(now() - 15 * 24 * HOUR, billId).run();
    await engine.writeBillsOwnEnding(env, (await getBillBySerial(env, bill.serial))!);
  }
  return c.json({ ok: true, serial: bill.serial, hops: segments.length });
});

/** Diary entries + illustrated stamps for a seeded bill's most recent hops. */
async function decorate(env: Env, bill: BillRow, count: number) {
  const pers = personalityOf(bill);
  const { results: hops } = await env.DB.prepare(
    "SELECT * FROM hops WHERE bill_id = ? AND status = 'confirmed' AND stamp_status != 'ready' ORDER BY idx DESC LIMIT ?",
  ).bind(bill.id, count).all<HopRow>();
  for (let i = 0; i < hops.length; i += 4) {
    await Promise.all(
      hops.slice(i, i + 4).map(async (hop) => {
        const place = placeLabel(hop);
        const day = Math.floor((hop.confirmed_at! - bill.created_at) / (24 * HOUR)) + 1;
        const { results: before } = await env.DB.prepare(
          "SELECT words FROM hops WHERE bill_id = ? AND status = 'confirmed' AND idx < ? ORDER BY idx DESC LIMIT 12",
        ).bind(bill.id, hop.idx).all<{ words: string }>();
        const d = await ai.writeDiary(env, {
          pers, serial: bill.serial, words: hop.words, note: null, place, hopNumber: hop.idx!, day,
          storyTail: before.reverse().map((b) => b.words).join(" "), goal: bill.goal_hops, penName: null,
        });
        await env.DB.prepare("INSERT INTO diary (id, bill_id, hop_id, kind, day_label, text, ai_meta, created_at) VALUES (?,?,?,?,?,?,?,?)")
          .bind(newId(), bill.id, hop.id, "hop", `Day ${day} — ${place}`, d.entry, JSON.stringify(d.meta), hop.confirmed_at).run();
        await engine.paintHopStamp(env, hop, d.motif);
      }),
    );
  }
  await touch(env, bill.id).run();
}

admin.post("/decorate", async (c) => {
  const { serial, stamps } = await c.req.json<{ serial: string; stamps?: number }>();
  const bill = await getBillBySerial(c.env, serial);
  if (!bill) return c.json({ error: "No such bill" }, 404);
  await decorate(c.env, bill, stamps ?? 8);
  return c.json({ ok: true });
});
