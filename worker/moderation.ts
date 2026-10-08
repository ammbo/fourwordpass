// A deliberately small filter: block slurs and the harshest profanity, allow
// "damn" and "hell" (stories need some teeth). Reject and let the person retry;
// never silently edit their words.

const BLOCKED_WORDS = new Set([
  "fuck", "fucking", "fucker", "fucked", "motherfucker", "shit", "shitty", "bullshit", "cunt", "cock", "dick",
  "pussy", "asshole", "bitch", "bastard", "whore", "slut", "twat", "wanker", "rape", "rapist", "porn",
  "nigger", "nigga", "faggot", "fag", "retard", "retarded", "spic", "chink", "kike", "tranny", "dyke", "wetback",
  "gook", "coon", "raghead", "towelhead",
]);

// Slurs that should never appear even inside other words.
const BLOCKED_FRAGMENTS = ["nigg", "fagg", "kike", "chink", "wetback"];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[013457@$!]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z\s]/g, "")
    .replace(/(.)\1{2,}/g, "$1$1");
}

export function isClean(text: string | null | undefined): boolean {
  if (!text) return true;
  const n = normalize(text);
  if (BLOCKED_FRAGMENTS.some((f) => n.replace(/\s/g, "").includes(f))) return false;
  return !n.split(/\s+/).some((w) => BLOCKED_WORDS.has(w) || BLOCKED_WORDS.has(w.replace(/(.)\1+/g, "$1")));
}

export const DIRTY_MESSAGE = "The buck has standards. Try different words.";
