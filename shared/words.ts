// The four-word rule. Shared by the browser (live counter) and the Worker (enforcement).
//
// Every contribution is exactly 4 *content* words. Stopwords ride along free so
// grammar still works ("the robot learned to dream tonight" = robot, learned,
// dream, tonight). Raw words are capped at 8 so nobody stuffs a sentence in.

export const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "at", "for",
  "with", "by", "from", "as", "is", "was", "are", "were", "be", "been", "it",
  "its", "this", "that", "then",
]);

export const CONTENT_WORDS = 4;
export const MAX_RAW_WORDS = 8;
export const FINALE_MAX_CONTENT = 12;
export const FINALE_MAX_RAW = 24;

export type Token = { raw: string; norm: string; content: boolean };

/** Collapse whitespace and trim. This is the exact text that gets stored and shown. */
export function normalizeWords(input: string): string {
  return input.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

/** Split into tokens. Pure punctuation and emoji are not words. Hyphenated words count once. */
export function tokenize(input: string): Token[] {
  const out: Token[] = [];
  for (const raw of normalizeWords(input).split(" ")) {
    const norm = raw
      .toLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!norm) continue;
    out.push({ raw, norm, content: !STOPWORDS.has(norm) });
  }
  return out;
}

const LINKY = /@|https?:|www\.|\.(com|net|org|io|ly|co|app)\b/i;

export type WordCheck = {
  ok: boolean;
  content: number;
  raw: number;
  tokens: Token[];
  error?: string;
};

export function checkFourWords(input: string): WordCheck {
  const tokens = tokenize(input);
  const content = tokens.filter((t) => t.content).length;
  const raw = tokens.length;
  let error: string | undefined;
  if (raw === 0) error = "Four words. That's all it takes.";
  else if (LINKY.test(input)) error = "No links or emails in the story. Just words.";
  else if (raw > MAX_RAW_WORDS) error = `Eight words max in total. You've got ${raw}.`;
  else if (content !== CONTENT_WORDS)
    error = `That's ${content} content word${content === 1 ? "" : "s"}. The buck demands four.`;
  return { ok: !error, content, raw, tokens, error };
}

/** The creator's finale gets more room to land the ending: 1–12 content words. */
export function checkFinale(input: string): WordCheck {
  const tokens = tokenize(input);
  const content = tokens.filter((t) => t.content).length;
  const raw = tokens.length;
  let error: string | undefined;
  if (content === 0) error = "An ending needs at least one real word.";
  else if (LINKY.test(input)) error = "No links or emails in the story. Just words.";
  else if (content > FINALE_MAX_CONTENT)
    error = `That's ${content} content words. Endings get twelve, tops.`;
  else if (raw > FINALE_MAX_RAW) error = `Keep it under ${FINALE_MAX_RAW} words in total.`;
  return { ok: !error, content, raw, tokens, error };
}

export function countContent(input: string): number {
  return tokenize(input).filter((t) => t.content).length;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/** j•••@g•••.com — enough for the holder to recognise, useless to anyone else. */
export function maskEmail(email: string): string {
  const [user, domain = ""] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${user.slice(0, 1)}•••@${host.slice(0, 1)}•••${tld}`;
}

const RESERVED_PEN_NAMES = new Set([
  "a stranger", "stranger", "anonymous", "admin", "administrator", "moderator", "support",
  "four word pass", "fourwordpass", "the buck", "the bill",
]);

/** A pen name you claim on your account. Stricter than a one-off signature, since it's yours for good. */
export function checkPenName(input: string): { ok: boolean; name: string; error?: string } {
  const name = normalizeWords(input);
  let error: string | undefined;
  if (name.length < 2 || name.length > 24) error = "Pen names run 2 to 24 characters.";
  else if (LINKY.test(name)) error = "No links or emails in a pen name.";
  else if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test(name) || !/\p{L}/u.test(name)) error = "Letters and numbers, plus spaces, dots, dashes, underscores and apostrophes.";
  else if (RESERVED_PEN_NAMES.has(name.toLowerCase())) error = "That one's reserved. Pick another.";
  return { ok: !error, name, error };
}
