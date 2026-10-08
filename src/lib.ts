export const INKS = ["#b3261e", "#1f4e9c", "#6b3fa0", "#2f6b3a", "#7a4a1f", "#0f6e74"];

export function hash(s: string | number): number {
  const str = String(s);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const inkFor = (seed: string | number) => INKS[hash(seed) % INKS.length];

export function timeAgo(t: number): string {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function age(t: number): string {
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d < 1) return "born today";
  return d === 1 ? "1 day old" : `${d} days old`;
}

export const stampDate = (t: number) =>
  new Date(t).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase().replace(",", "");

export const longDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export const nf = (n: number) => n.toLocaleString("en-US");

export const STATUS_LABEL: Record<string, string> = {
  in_transit: "In transit",
  holding: "In someone's pocket",
  wild: "In the wild",
  complete: "Complete",
  eulogized: "Lost · eulogized",
};

export const STATUS_TONE: Record<string, string> = {
  in_transit: "bg-amber-100 text-amber-900 border-amber-300",
  holding: "bg-emerald-50 text-emerald-900 border-emerald-300",
  wild: "bg-violet-50 text-violet-900 border-violet-300",
  complete: "bg-sky-50 text-sky-900 border-sky-300",
  eulogized: "bg-stone-200 text-stone-700 border-stone-300",
};
