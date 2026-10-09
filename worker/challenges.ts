// Emailed proof that someone reads an inbox: a one-tap link and, for someone waiting on the page,
// a six-digit code. Sign-in uses them, and so does every email that offers to turn a follow, a claim
// or a release into an account. Nothing here creates an account; verifying a challenge does (accounts.ts).

import { checkPenName } from "../shared/words";
import { DIRTY_MESSAGE, isClean } from "./moderation";
import { DAY, HOUR, appUrl, capToken, newId, now, participantId, randomToken, sha256Hex } from "./util";

export const CODE_TTL = 15 * 60_000;
/** Offers ride along on emails people may open days later. */
export const OFFER_TTL = 7 * DAY;
const PER_HOUR = 6;
const PER_DAY = 12;

/** Why this address can't have another challenge right now, or null. Offers skip the half-minute wait. */
export async function challengeLimit(env: Env, email: string, waitBetween = true): Promise<string | null> {
  const t = now();
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS day, COALESCE(SUM(created_at > ?), 0) AS hour, COALESCE(SUM(created_at > ?), 0) AS fresh
    FROM auth_challenges WHERE email = ? AND created_at > ?`)
    .bind(t - HOUR, t - 30_000, email, t - DAY).first<{ day: number; hour: number; fresh: number }>();
  if (waitBetween && recent?.fresh) return "A code is already on its way. Give it half a minute, then try again.";
  if ((recent?.hour ?? 0) >= PER_HOUR) return "That's a lot of codes. Try again in an hour.";
  if ((recent?.day ?? 0) >= PER_DAY) return "That's a lot of codes for one day. Try again tomorrow.";
  return null;
}

export type Challenge = { id: string; code: string | null; url: string };

/**
 * Stores only hashes. Without a code, the stored code hash is random, so only the link works.
 * A fixed id (a release's offer) derives its link from the id, so a replayed release builds the
 * same link as the one already queued in its email.
 */
export async function createChallenge(env: Env, email: string, opts: {
  id?: string; withCode?: boolean; handle?: string | null; followId?: string | null; next?: string | null; ttl?: number;
} = {}): Promise<Challenge> {
  const t = now();
  const id = opts.id ?? newId();
  const code = opts.withCode ? String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0") : null;
  const link = opts.id ? await capToken(env, "signin", `link:${id}`) : randomToken();
  await env.DB.prepare(`INSERT OR IGNORE INTO auth_challenges (id, email, code_hash, link_hash, handle, follow_id, expires_at, created_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .bind(id, email, code ? await capToken(env, "signin", `${id}:${code}`) : randomToken(), await sha256Hex(link),
      opts.handle ?? null, opts.followId ?? null, t + (opts.ttl ?? CODE_TTL), t).run();
  const params = new URLSearchParams({ ch: id, k: link });
  if (opts.next) params.set("next", opts.next);
  if (opts.handle) params.set("pen", opts.handle);
  return { id, code, url: appUrl(env, `/signin?${params}`) };
}

/** The pen name this address can claim, or why it can't. Its owner can always ask for it again. */
export async function penNameFor(env: Env, raw: string, email: string): Promise<{ name: string } | { error: string }> {
  const check = checkPenName(raw);
  if (!check.ok) return { error: check.error! };
  if (!isClean(check.name)) return { error: DIRTY_MESSAGE };
  const owner = await env.DB.prepare("SELECT pid FROM users WHERE handle = ? COLLATE NOCASE").bind(check.name).first<{ pid: string }>();
  if (owner && owner.pid !== (await participantId(env, email))) return { error: "That pen name is taken. Try another." };
  return { name: check.name };
}
