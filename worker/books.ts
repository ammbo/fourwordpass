// Open Books: every dollar in and out, straight from our own PayPal records.
// The platform is the sender on every payout and the merchant on every checkout,
// so it can publish all of them. Public projection only: no emails, no internal
// ids, PayPal references masked to their last four characters.

import type { BooksRow, OpenBooks } from "../shared/types";
import { countContent } from "../shared/words";
import { maskId } from "./util";

const LEDGER_LIMIT = 2000;

/** Stable, opaque row ids so the grid can update rows in place without exposing pass ids. */
function opaque(id: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b, 33) ^ c;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

const PASS_KIND: Record<string, BooksRow["kind"]> = { mint: "first_holder", fork: "first_holder", claim: "claim", pass: "pass" };

export async function openBooks(env: Env): Promise<OpenBooks> {
  const [checkouts, passes, totals, words, finales, voice, stamps] = await Promise.all([
    env.DB.prepare(
      `SELECT id, serial, checkout_order_id, checkout_mode, forked_from_bill_id, created_at FROM bills
       WHERE checkout_order_id IS NOT NULL ORDER BY created_at DESC LIMIT ?`,
    ).bind(LEDGER_LIMIT).all<{ id: string; serial: string; checkout_order_id: string; checkout_mode: BooksRow["mode"]; forked_from_bill_id: string | null; created_at: number }>(),
    env.DB.prepare(
      `SELECT p.id, p.kind, p.status, p.paypal_mode, p.paypal_status, p.payout_item_id, p.payout_batch_id, p.created_at, p.settled_at,
              b.serial, h.idx AS hop_idx, h.status AS hop_status,
              (SELECT MIN(received_at) FROM payout_events e WHERE e.pass_id = p.id) AS webhook_at
       FROM passes p JOIN bills b ON b.id = p.bill_id LEFT JOIN hops h ON h.id = p.from_hop_id
       ORDER BY p.created_at DESC LIMIT ?`,
    ).bind(LEDGER_LIMIT).all<{
      id: string; kind: string; status: "pending" | "delivered" | "failed"; paypal_mode: string; paypal_status: string | null;
      payout_item_id: string | null; payout_batch_id: string | null; created_at: number; settled_at: number | null;
      serial: string; hop_idx: number | null; hop_status: string | null; webhook_at: number | null;
    }>(),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM bills WHERE checkout_order_id IS NOT NULL) AS checkouts,
              (SELECT COUNT(*) FROM passes WHERE status = 'delivered') AS delivered,
              (SELECT COUNT(*) FROM passes WHERE status = 'pending') AS pending,
              (SELECT COUNT(*) FROM passes WHERE status = 'failed') AS failed,
              (SELECT COUNT(*) FROM bills WHERE status = 'wild' AND is_seed = 0) AS wild`,
    ).first<{ checkouts: number; delivered: number; pending: number; failed: number; wild: number }>(),
    // Story words from real bills only. Demo histories are simulated, so they don't count here.
    env.DB.prepare(
      `SELECT COALESCE(SUM(h.content_words), 0) AS n, COUNT(*) AS hops FROM hops h JOIN bills b ON b.id = h.bill_id
       WHERE h.status = 'confirmed' AND h.inherited_from_hop_id IS NULL AND b.is_seed = 0`,
    ).first<{ n: number; hops: number }>(),
    env.DB.prepare("SELECT finale_text, finale_by FROM bills WHERE finale_text IS NOT NULL AND is_seed = 0").all<{ finale_text: string; finale_by: string | null }>(),
    env.DB.prepare(
      `SELECT json_extract(d.ai_meta, '$.model') AS model, COUNT(*) AS n FROM diary d JOIN bills b ON b.id = d.bill_id
       WHERE b.is_seed = 0 AND d.ai_meta IS NOT NULL GROUP BY model ORDER BY n DESC`,
    ).all<{ model: string | null; n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM hops h JOIN bills b ON b.id = h.bill_id
       WHERE b.is_seed = 0 AND h.stamp_status = 'ready' AND h.inherited_from_hop_id IS NULL`,
    ).first<{ n: number }>(),
  ]);

  const rows: BooksRow[] = [
    ...checkouts.results.map((b): BooksRow => ({
      id: opaque(b.id),
      at: b.created_at,
      direction: "in",
      amount: 2,
      kind: b.forked_from_bill_id ? "fork" : "release",
      serial: b.serial,
      hop: null,
      paypalStatus: "COMPLETED",
      outcome: "landed",
      ref: maskId(b.checkout_order_id),
      secondsToLand: null,
      settledBy: null,
      webhook: false,
      mode: b.checkout_mode,
    })),
    ...passes.results.map((p): BooksRow => ({
      id: opaque(p.id),
      at: p.created_at,
      direction: "out",
      amount: 1,
      kind: PASS_KIND[p.kind] ?? "pass",
      serial: p.serial,
      hop: p.hop_status === "confirmed" ? p.hop_idx : null,
      paypalStatus: p.paypal_status ?? (p.status === "failed" ? "FAILED" : "PENDING"),
      outcome: p.status === "delivered" ? "landed" : p.status === "failed" ? "failed" : "in_flight",
      ref: maskId(p.payout_item_id ?? p.payout_batch_id),
      secondsToLand: p.status === "delivered" && p.settled_at ? Math.max(0, Math.round((p.settled_at - p.created_at) / 1000)) : null,
      // A signed webhook arriving no later than settlement means PayPal told us first.
      settledBy: p.status === "pending" ? null : p.webhook_at && p.settled_at && p.webhook_at <= p.settled_at + 1000 ? "webhook" : "polling",
      webhook: !!p.webhook_at,
      mode: p.paypal_mode as BooksRow["mode"],
    })),
  ].sort((a, b) => b.at - a.at);

  let creatorWords = 0, billWords = 0;
  for (const f of finales.results) {
    if (f.finale_by === "bill") billWords += countContent(f.finale_text);
    else creatorWords += countContent(f.finale_text);
  }

  const t = totals ?? { checkouts: 0, delivered: 0, pending: 0, failed: 0, wild: 0 };
  return {
    totals: {
      paidIn: t.checkouts * 2,
      checkouts: t.checkouts,
      paidOut: t.delivered,
      payouts: t.delivered,
      inFlight: t.pending,
      failed: t.failed,
      heldForWild: t.wild,
    },
    rows,
    words: {
      holders: words?.n ?? 0,
      hops: words?.hops ?? 0,
      creatorFinales: creatorWords,
      billClosings: billWords,
    },
    voice: [
      ...voice.results.map((v) => ({ model: v.model ?? "unknown", pieces: v.n, kind: "writing" as const })),
      ...(stamps?.n ? [{ model: "@cf/black-forest-labs/flux-1-schnell", pieces: stamps.n, kind: "stamps" as const }] : []),
    ],
    generatedAt: Date.now(),
  };
}
