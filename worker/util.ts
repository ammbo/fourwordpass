export const now = () => Date.now();
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export function newId(): string {
  return crypto.randomUUID();
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const keyCache = new Map<string, CryptoKey>();
async function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keyCache.set(secret, key);
  }
  return key;
}

type Purpose = "holder" | "creator" | "follow" | "ticket" | "participant" | "signin";

/**
 * Capability tokens are HMACs of a purpose + record id. Nothing is stored, and
 * rotation is free: a holder token is derived from the pass that delivered the
 * bill, so the next delivered pass invalidates it.
 */
export async function capToken(env: Env, purpose: Purpose, id: string): Promise<string> {
  const secret = env.TOKEN_SECRET;
  if (!secret) throw new Error("TOKEN_SECRET is not set");
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(`${purpose}:${id}`));
  return b64url(sig).slice(0, 32);
}

export async function checkCap(env: Env, purpose: Purpose, id: string | null | undefined, token: string | null | undefined): Promise<boolean> {
  if (!id || !token) return false;
  return sameString(await capToken(env, purpose, id), token);
}

export function sameString(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

/**
 * Who someone is, without saying who: a keyed hash of their email. Every role a person
 * plays (creator, recipient, writer, follower) records it, so signing up later finds the
 * whole history. It depends on TOKEN_SECRET; rotating that secret orphans existing history.
 */
export const participantId = (env: Env, email: string) => capToken(env, "participant", email.trim().toLowerCase());

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function appUrl(env: Env, path: string): string {
  return `${(env.APP_URL || "https://fourwordpass.com").replace(/\/$/, "")}${path}`;
}

export function maskId(id: string | null | undefined): string {
  if (!id) return "••••";
  return `••••${id.slice(-4)}`;
}

/** Coarse, city-level place from Cloudflare's edge geolocation. Never precise. */
export type Place = { city: string | null; region: string | null; country: string | null; lat: number | null; lng: number | null };

export function placeFromRequest(req: Request): Place {
  const cf = (req as unknown as { cf?: IncomingRequestCfProperties }).cf;
  const round = (v: unknown) => (v == null || v === "" ? null : Math.round(Number(v) * 10) / 10);
  return {
    city: (cf?.city as string) || null,
    region: (cf?.regionCode as string) || (cf?.region as string) || null,
    country: (cf?.country as string) || null,
    lat: round(cf?.latitude),
    lng: round(cf?.longitude),
  };
}

export function placeLabel(p: { city: string | null; region: string | null; country: string | null }): string {
  if (!p.city) return p.country ? countryName(p.country) : "Somewhere";
  if (p.country === "US" && p.region) return `${p.city}, ${p.region}`;
  return p.country ? `${p.city}, ${countryName(p.country)}` : p.city;
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function sha256Hex(key: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
}

export const recoveryHash = sha256Hex;
