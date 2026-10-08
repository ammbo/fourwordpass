import type { BillStatus, Personality } from "../shared/types";

export type BillRow = {
  id: string;
  seq: number;
  serial: string;
  status: BillStatus;
  theme: string | null;
  goal_hops: number | null;
  personality: string;
  creator_email: string | null;
  origin_city: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  forked_from_bill_id: string | null;
  forked_at_hop: number | null;
  holder_pass_id: string | null;
  holder_since: number | null;
  held_via_wild: number;
  wild_since: number | null;
  nag_level: number;
  hop_count: number;
  word_count: number;
  follower_count: number;
  finale_text: string | null;
  finale_by: "creator" | "bill" | null;
  eulogy: string | null;
  goal_notified: number;
  featured: number;
  is_seed: number;
  checkout_order_id: string | null;
  version: number;
  created_at: number;
  ended_at: number | null;
};

export type PassRow = {
  id: string;
  bill_id: string;
  kind: "mint" | "fork" | "pass" | "claim";
  recipient_email: string;
  from_hop_id: string | null;
  status: "pending" | "delivered" | "failed";
  paypal_mode: string;
  payout_batch_id: string | null;
  payout_item_id: string | null;
  transaction_id: string | null;
  paypal_status: string | null;
  error: string | null;
  poll_count: number;
  next_poll_at: number | null;
  holder_notified: number;
  suggest_count: number;
  created_at: number;
  settled_at: number | null;
};

export type HopRow = {
  id: string;
  bill_id: string;
  idx: number | null;
  status: "pending" | "confirmed" | "void" | "removed";
  words: string;
  content_words: number;
  note: string | null;
  pen_name: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  writer_email: string | null;
  received_pass_id: string | null;
  ai_assisted: number;
  inherited_from_hop_id: string | null;
  stamp_key: string | null;
  stamp_status: "pending" | "ready" | "failed" | "none";
  diary_done: number;
  followers_notified: number;
  fx_attempts: number;
  created_at: number;
  confirmed_at: number | null;
};

export function personalityOf(bill: Pick<BillRow, "personality">): Personality {
  try {
    const p = JSON.parse(bill.personality) as Partial<Personality>;
    return {
      name: p.name || "Buck",
      tagline: p.tagline || "A plain old dollar with big plans.",
      voice: p.voice || "dry, curious",
      quirks: p.quirks || [],
    };
  } catch {
    return { name: "Buck", tagline: "A plain old dollar with big plans.", voice: "dry, curious", quirks: [] };
  }
}

export const getBillBySerial = (env: Env, serial: string) =>
  env.DB.prepare("SELECT * FROM bills WHERE serial = ?").bind(serial.toUpperCase()).first<BillRow>();

export const getBill = (env: Env, id: string) => env.DB.prepare("SELECT * FROM bills WHERE id = ?").bind(id).first<BillRow>();

export const getPass = (env: Env, id: string) => env.DB.prepare("SELECT * FROM passes WHERE id = ?").bind(id).first<PassRow>();

export const getHop = (env: Env, id: string) => env.DB.prepare("SELECT * FROM hops WHERE id = ?").bind(id).first<HopRow>();

export const latestPendingPass = (env: Env, billId: string) =>
  env.DB.prepare("SELECT * FROM passes WHERE bill_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
    .bind(billId)
    .first<PassRow>();

export async function confirmedHops(env: Env, billId: string, limit = 5000): Promise<HopRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM hops WHERE bill_id = ? AND status = 'confirmed' ORDER BY idx ASC LIMIT ?",
  )
    .bind(billId, limit)
    .all<HopRow>();
  return results;
}

/** The last ~n words of the story, for AI context and teasers. */
export async function storyTail(env: Env, billId: string, words = 60): Promise<string> {
  const { results } = await env.DB.prepare(
    "SELECT words FROM hops WHERE bill_id = ? AND status = 'confirmed' ORDER BY idx DESC LIMIT ?",
  )
    .bind(billId, Math.ceil(words / 4))
    .all<{ words: string }>();
  const text = results.reverse().map((r) => r.words).join(" ");
  const parts = text.split(" ");
  return parts.slice(-words).join(" ");
}

/** Bump the version so watching pages refetch. */
export const touch = (env: Env, billId: string) =>
  env.DB.prepare("UPDATE bills SET version = version + 1 WHERE id = ?").bind(billId);
