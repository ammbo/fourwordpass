import type { HopRow } from "./db";

export const STORY_PAGE_SIZE = 200;
export type StoryCursor = { before?: number; after?: number };

export function parseStoryCursor(params: URLSearchParams): StoryCursor {
  const before = params.get("before"), after = params.get("after");
  if (before !== null && after !== null) throw new Error("Choose one story cursor.");
  const raw = before ?? after;
  if (raw === null) return {};
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid story cursor.");
  return before !== null ? { before: value } : { after: value };
}

/** Keyset pagination stays stable as new hops are appended or moderated out. */
export async function readHopPage(env: Env, billId: string, cursor: StoryCursor = {}): Promise<{
  rows: HopRow[];
  placeCount: number;
  history: {olderBefore: number | null; newerAfter: number | null};
}> {
  const ascending = cursor.after !== undefined;
  const { results } = await env.DB.prepare(`SELECT * FROM hops WHERE bill_id = ? AND status = 'confirmed'
    AND idx ${ascending ? ">" : "<"} ? ORDER BY idx ${ascending ? "ASC" : "DESC"} LIMIT ?`)
    .bind(billId, cursor.after ?? cursor.before ?? Number.MAX_SAFE_INTEGER, STORY_PAGE_SIZE).all<HopRow>();
  // Old bookmarks can point past the remaining history after moderation.
  if (!results.length && (cursor.before !== undefined || (cursor.after ?? 0) > 0)) {
    return readHopPage(env, billId, ascending ? {} : {after: 0});
  }
  const rows = ascending ? results : results.reverse();
  const bounds = await env.DB.prepare("SELECT MIN(idx) AS first, MAX(idx) AS last, COUNT(DISTINCT CASE WHEN city IS NOT NULL THEN city || ',' || COALESCE(country,'') END) AS places FROM hops WHERE bill_id = ? AND status = 'confirmed'")
    .bind(billId).first<{first: number | null; last: number | null; places: number}>();
  const first = rows[0]?.idx, last = rows.at(-1)?.idx;
  return { rows, placeCount: bounds?.places ?? 0, history: {
    olderBefore: first != null && bounds?.first != null && first > bounds.first ? first : null,
    newerAfter: last != null && bounds?.last != null && last < bounds.last ? last : null,
  }};
}
