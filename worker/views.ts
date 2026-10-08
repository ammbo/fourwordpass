// Public projections. Emails, payout ids and ai_assisted flags never leave here.

import type { BillSummary, CreatorView, HolderView, PublicBill, PublicHop, Receipt } from "../shared/types";
import { maskEmail } from "../shared/words";
import { type BillRow, type HopRow, type PassRow, getPass, latestPendingPass, personalityOf } from "./db";
import { checkCap, maskId, placeFromRequest, placeLabel } from "./util";

const SUGGESTIONS_PER_HOLDER = 5;

export async function publicBill(env: Env, bill: BillRow): Promise<PublicBill> {
  const [hopsRes, passesRes, diaryRes, parent, forksRes] = await Promise.all([
    env.DB.prepare("SELECT * FROM hops WHERE bill_id = ? AND status = 'confirmed' ORDER BY idx ASC LIMIT 5000").bind(bill.id).all<HopRow>(),
    env.DB.prepare(
      `SELECT p.id, p.paypal_mode, p.payout_item_id, p.payout_batch_id, p.paypal_status FROM passes p
       WHERE p.status = 'delivered' AND p.id IN (SELECT received_pass_id FROM hops WHERE bill_id = ?1 AND status = 'confirmed'
         UNION SELECT p2.id FROM passes p2 JOIN hops h ON h.id = p2.from_hop_id WHERE h.bill_id = ?1 AND p2.kind IN ('mint','fork'))`,
    ).bind(bill.id).all<Pick<PassRow, "id" | "paypal_mode" | "payout_item_id" | "payout_batch_id" | "paypal_status">>(),
    env.DB.prepare("SELECT kind, day_label, text, created_at FROM diary WHERE bill_id = ? ORDER BY created_at DESC LIMIT 400").bind(bill.id).all<{ kind: string; day_label: string | null; text: string; created_at: number }>(),
    bill.forked_from_bill_id ? env.DB.prepare("SELECT serial FROM bills WHERE id = ?").bind(bill.forked_from_bill_id).first<{ serial: string }>() : null,
    env.DB.prepare("SELECT serial, forked_at_hop, hop_count, status FROM bills WHERE forked_from_bill_id = ? ORDER BY created_at").bind(bill.id).all<{ serial: string; forked_at_hop: number; hop_count: number; status: BillRow["status"] }>(),
  ]);

  const receipts = new Map<string, Receipt>();
  for (const p of passesRes.results) {
    receipts.set(p.id, {
      mode: p.paypal_mode === "mock" ? "mock" : "sandbox",
      item: maskId(p.payout_item_id ?? p.payout_batch_id),
      status: p.paypal_status ?? "SUCCESS",
    });
  }
  // The receipt shown on a hop is the payout that put the bill in its writer's hands.
  // The creator's opening hop shows the payout that carried it to the first holder.
  const mintReceipt = passesRes.results.length
    ? await env.DB.prepare("SELECT from_hop_id, id FROM passes WHERE bill_id = ? AND kind IN ('mint','fork') AND status = 'delivered'").bind(bill.id).first<{ from_hop_id: string; id: string }>()
    : null;

  const hops: PublicHop[] = hopsRes.results.map((h) => ({
    idx: h.idx!,
    words: h.words,
    contentWords: h.content_words,
    penName: h.pen_name,
    place: placeLabel(h),
    lat: h.lat,
    lng: h.lng,
    note: h.note,
    stampUrl: h.stamp_key ? `/api/stamps/${h.stamp_key.replace(/^stamps\//, "")}` : null,
    stampStatus: h.stamp_status,
    receipt:
      (h.received_pass_id ? receipts.get(h.received_pass_id) : mintReceipt?.from_hop_id === h.id ? receipts.get(mintReceipt.id) : null) ??
      (bill.is_seed && !h.received_pass_id ? { mode: "seed", item: "••••DEMO", status: "SIMULATED" } : null),
    inherited: !!h.inherited_from_hop_id,
    confirmedAt: h.confirmed_at ?? h.created_at,
  }));

  let holderPlace: string | null = null;
  if (bill.status === "holding" && bill.holder_pass_id) {
    const last = hopsRes.results[hopsRes.results.length - 1];
    holderPlace = last ? placeLabel(last) : bill.origin_city;
  }

  return {
    serial: bill.serial,
    status: bill.status,
    theme: bill.theme,
    goalHops: bill.goal_hops,
    personality: personalityOf(bill),
    originCity: bill.origin_city,
    createdAt: bill.created_at,
    endedAt: bill.ended_at,
    hopCount: bill.hop_count,
    wordCount: bill.word_count,
    followerCount: bill.follower_count,
    featured: !!bill.featured,
    isSeed: !!bill.is_seed,
    version: bill.version,
    holderPlace,
    holderSince: bill.holder_since,
    wildSince: bill.wild_since,
    forkedFrom: parent ? { serial: parent.serial, atHop: bill.forked_at_hop ?? 0 } : null,
    forks: forksRes.results.map((f) => ({ serial: f.serial, atHop: f.forked_at_hop, hopCount: f.hop_count, status: f.status })),
    finale: bill.finale_text ? { text: bill.finale_text, by: bill.finale_by ?? "creator" } : null,
    eulogy: bill.eulogy,
    hops,
    diary: diaryRes.results.map((d) => ({ kind: d.kind, dayLabel: d.day_label, text: d.text, createdAt: d.created_at })),
  };
}

export async function summaries(env: Env, where: string, order: string, limit: number, ...binds: unknown[]): Promise<BillSummary[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM bills WHERE ${where} ORDER BY ${order} LIMIT ?`).bind(...binds, limit).all<BillRow>();
  return Promise.all(
    results.map(async (b) => {
      const { results: tail } = await env.DB.prepare(
        "SELECT words, city, region, country FROM hops WHERE bill_id = ? AND status = 'confirmed' ORDER BY idx DESC LIMIT 4",
      ).bind(b.id).all<{ words: string; city: string | null; region: string | null; country: string | null }>();
      const words = tail.map((t) => t.words).reverse().join(" ").split(" ");
      return {
        serial: b.serial,
        status: b.status,
        theme: b.theme,
        personaName: personalityOf(b).name,
        hopCount: b.hop_count,
        wordCount: b.word_count,
        followerCount: b.follower_count,
        goalHops: b.goal_hops,
        originCity: b.origin_city,
        lastPlace: tail[0] ? placeLabel(tail[0]) : b.origin_city,
        teaser: words.slice(-12).join(" "),
        createdAt: b.created_at,
        featured: !!b.featured,
        isSeed: !!b.is_seed,
      };
    }),
  );
}

export async function holderView(env: Env, req: Request, bill: BillRow, token: string): Promise<HolderView> {
  if (bill.status === "complete" || bill.status === "eulogized") return { state: "ended" };

  // Current holder?
  if (bill.holder_pass_id && (await checkCap(env, "holder", bill.holder_pass_id, token))) {
    const holderPass = (await getPass(env, bill.holder_pass_id))!;
    if (bill.status === "in_transit") {
      const out = await latestPendingPass(env, bill.id);
      const hop = out?.from_hop_id ? await env.DB.prepare("SELECT words FROM hops WHERE id = ?").bind(out.from_hop_id).first<{ words: string }>() : null;
      return {
        state: "in_transit",
        recipient: out ? maskEmail(out.recipient_email) : "",
        paypalStatus: out?.paypal_status ?? null,
        mode: out?.paypal_mode ?? "sandbox",
        words: hop?.words ?? "",
      };
    }
    if (bill.status === "holding") {
      const failed = await env.DB.prepare(
        `SELECT p.recipient_email, p.error, h.words FROM passes p JOIN hops h ON h.id = p.from_hop_id
         WHERE p.bill_id = ? AND p.kind = 'pass' AND p.status = 'failed' AND p.created_at > ? ORDER BY p.created_at DESC LIMIT 1`,
      ).bind(bill.id, bill.holder_since ?? 0).first<{ recipient_email: string; error: string | null; words: string }>();
      const place = placeFromRequest(req);
      return {
        state: "holding",
        followerCount: bill.follower_count,
        suggestionsLeft: Math.max(0, SUGGESTIONS_PER_HOLDER - holderPass.suggest_count),
        place: { city: place.city, region: place.region, country: place.country },
        lastFailure: failed ? { recipient: maskEmail(failed.recipient_email), error: failed.error ?? "Payment failed", words: failed.words } : null,
        viaWild: !!bill.held_via_wild,
        holderSince: bill.holder_since ?? Date.now(),
      };
    }
  }

  // A claimer (or recipient) whose dollar is still in flight.
  const pending = await latestPendingPass(env, bill.id);
  if (pending && (await checkCap(env, "holder", pending.id, token))) {
    return { state: "arriving", paypalStatus: pending.paypal_status, mode: pending.paypal_mode };
  }
  return { state: "moved_on" };
}

export async function creatorView(env: Env, bill: BillRow, token: string): Promise<CreatorView> {
  if (!(await checkCap(env, "creator", bill.id, token))) return { valid: false };
  return {
    valid: true,
    canEnd: bill.status === "holding" || bill.status === "wild",
    status: bill.status,
    hopCount: bill.hop_count,
    goalHops: bill.goal_hops,
  };
}

export { SUGGESTIONS_PER_HOLDER };
