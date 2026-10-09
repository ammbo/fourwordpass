// Runs every minute. Each job is small, bounded, and idempotent.

import type { BillRow, PassRow } from "./db";
import * as engine from "./engine";
import { DAY, HOUR, now } from "./util";

type Ctx = { waitUntil(p: Promise<unknown>): void };

async function safely(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error(`cron:${label}`, e);
  }
}

export async function runCron(env: Env, ctx: Ctx) {
  const t = now();

  // 1. Payouts in flight: poll the ones the webhook hasn't settled, retry the ones a PayPal
  //    hiccup stopped (left alone for 30s so a slow first attempt isn't raced), and fail any
  //    that are stuck past the timeout.
  await safely("poll", async () => {
    const { results } = await env.DB.prepare(
      `SELECT * FROM passes WHERE status = 'pending' AND next_poll_at <= ?1
         AND (payout_batch_id IS NOT NULL OR created_at < ?1 - 30000)
       ORDER BY next_poll_at LIMIT 25`,
    ).bind(t).all<PassRow>();
    for (const p of results) await safely(`poll:${p.id}`, () => engine.advancePass(env, ctx, p));
  });

  // 2. Side effects that waitUntil didn't finish (holder email, diary, followers, stamp).
  await safely("deliveries", async () => {
    const { results } = await env.DB.prepare(
      "SELECT id FROM passes WHERE status = 'delivered' AND holder_notified = 0 AND settled_at < ? LIMIT 10",
    ).bind(t - 20_000).all<{ id: string }>();
    for (const p of results) await safely(`deliver:${p.id}`, () => engine.afterDelivery(env, p.id));
  });
  await safely("hop-fx", async () => {
    const { results } = await env.DB.prepare(
      `SELECT h.id FROM hops h JOIN bills b ON b.id = h.bill_id
       WHERE h.status = 'confirmed' AND h.inherited_from_hop_id IS NULL AND b.is_seed = 0
         AND (h.diary_done = 0 OR h.followers_notified = 0 OR h.stamp_status = 'pending') AND h.confirmed_at < ?
       ORDER BY h.confirmed_at LIMIT 4`,
    ).bind(t - 45_000).all<{ id: string }>();
    for (const h of results) await safely(`fx:${h.id}`, () => engine.runHopEffects(env, h.id));
  });

  // 3. Wild claimers who never wrote: back to the wild after 24h.
  await safely("wild-return", async () => {
    const { results } = await env.DB.prepare(
      "SELECT * FROM bills WHERE status = 'holding' AND held_via_wild = 1 AND holder_since < ? LIMIT 10",
    ).bind(t - DAY).all<BillRow>();
    for (const b of results) await safely(`wild:${b.serial}`, () => engine.returnToWild(env, b));
  });

  // 4. The nag ladder: 24h, 72h, 7d.
  await safely("nags", async () => {
    const ladder: [1 | 2 | 3, number][] = [[3, 7 * DAY], [2, 72 * HOUR], [1, DAY]];
    for (const [level, age] of ladder) {
      const { results } = await env.DB.prepare(
        "SELECT * FROM bills WHERE status = 'holding' AND held_via_wild = 0 AND nag_level < ? AND holder_since < ? LIMIT 5",
      ).bind(level, t - age).all<BillRow>();
      for (const b of results) await safely(`nag:${b.serial}`, () => engine.nag(env, b, level));
    }
  });

  // Keep the test inbox small.
  await safely("inbox-trim", () => env.DB.prepare("DELETE FROM inbox WHERE received_at < ?").bind(t - 30 * DAY).run());

  // 5. Fourteen days without moving: the bill writes its eulogy and closes the story.
  await safely("deaths", async () => {
    const { results } = await env.DB.prepare(
      `SELECT * FROM bills WHERE (status = 'holding' AND holder_since < ?1) OR (status = 'wild' AND wild_since < ?1) LIMIT 3`,
    ).bind(t - 14 * DAY).all<BillRow>();
    for (const b of results) await safely(`death:${b.serial}`, () => engine.writeBillsOwnEnding(env, b));
  });
}
