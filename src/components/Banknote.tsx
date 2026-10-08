import { useMemo } from "react";
import { hash } from "../lib";

/** A spirograph rosette, unique per serial, like the engraved medallions on real currency. */
export function Rosette({ seed, size = 100, color = "#17402f", opacity = 0.55 }: { seed: string; size?: number | string; color?: string; opacity?: number }) {
  const paths = useMemo(() => {
    const h = hash(seed);
    const out: string[] = [];
    const sets = [
      { R: 46, r: 7 + (h % 9), d: 18 + ((h >> 4) % 14) },
      { R: 46, r: 11 + ((h >> 8) % 7), d: 26 + ((h >> 12) % 10) },
    ];
    for (const { R, r, d } of sets) {
      const k = (R - r) / r;
      let p = "";
      const steps = 1400;
      // Enough turns to close the curve for these integer radii.
      const turns = r / gcd(R, r);
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2 * turns;
        const x = (R - r) * Math.cos(t) + d * Math.cos(k * t);
        const y = (R - r) * Math.sin(t) - d * Math.sin(k * t);
        const s = (x * 0.5 + 50).toFixed(2) + " " + (y * 0.5 + 50).toFixed(2);
        p += i === 0 ? `M${s}` : `L${s}`;
      }
      out.push(p);
    }
    return out;
  }, [seed]);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={0.35} opacity={opacity - i * 0.15} />
      ))}
      <circle cx="50" cy="50" r="48" fill="none" stroke={color} strokeWidth="0.6" opacity={opacity} />
      <circle cx="50" cy="50" r="45.5" fill="none" stroke={color} strokeWidth="0.3" opacity={opacity} strokeDasharray="0.8 1.2" />
    </svg>
  );
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

type Props = {
  serial: string;
  persona?: string;
  words?: string;
  hops?: number;
  className?: string;
  tilt?: number;
  muted?: boolean;
};

export function Banknote({ serial, persona, words, hops, className = "", tilt = 0, muted }: Props) {
  return (
    <div
      className={`relative w-full select-none ${className}`}
      style={{ containerType: "inline-size", transform: tilt ? `rotate(${tilt}deg)` : undefined }}
    >
      <div
        className={`guilloche relative aspect-[2.3/1] overflow-hidden rounded-[3.5cqw] border-[0.5cqw] border-ink shadow-[0_24px_50px_-28px_rgba(23,64,47,0.75)] ${muted ? "grayscale-[.7] opacity-80" : ""}`}
      >
        {/* inner engraved frame */}
        <div className="absolute inset-[2.4cqw] rounded-[2cqw] border-[0.25cqw] border-ink/60" />
        <div className="absolute inset-[3.3cqw] rounded-[1.6cqw] border-[0.12cqw] border-dashed border-ink/40" />

        {/* corner serials */}
        <div className="serial absolute left-[5cqw] top-[4.6cqw] text-[3.1cqw]">{serial}</div>
        <div className="serial absolute bottom-[4.4cqw] right-[5cqw] text-[3.1cqw]">{serial}</div>

        {/* corner denominations */}
        <div className="absolute right-[5cqw] top-[3.2cqw] font-display text-[6.5cqw] font-bold leading-none text-ink/85">1</div>
        <div className="absolute bottom-[3.3cqw] left-[5cqw] font-display text-[6.5cqw] font-bold leading-none text-ink/85">1</div>

        {/* left medallion */}
        <div className="absolute left-[9cqw] top-1/2 -translate-y-1/2">
          <div className="relative grid place-items-center" style={{ width: "26cqw", height: "26cqw" }}>
            <div className="absolute inset-0">
              <Rosette seed={serial} size="100%" />
            </div>
            <div className="relative grid place-items-center rounded-full border-[0.3cqw] border-ink/70 bg-bill/90" style={{ width: "13cqw", height: "13cqw" }}>
              <span className="font-display text-[7cqw] font-bold italic leading-none text-ink">4</span>
            </div>
          </div>
        </div>

        {/* center text */}
        <div className="absolute left-[38cqw] right-[7cqw] top-[10cqw] text-ink">
          <div className="font-mono text-[1.9cqw] font-semibold uppercase tracking-[0.3em] text-ink/70">Four Word Pass</div>
          <div className="mt-[1.2cqw] truncate font-display text-[4.6cqw] font-semibold italic leading-[1.05]">{persona ?? "One Dollar"}</div>
          <div className="mt-[1.4cqw] font-mono text-[1.6cqw] uppercase tracking-[0.24em] text-ink/60">
            This note carries a story{hops != null ? ` · ${hops} hop${hops === 1 ? "" : "s"}` : ""}
          </div>
          {words ? (
            <div className="mt-[2.2cqw] line-clamp-2 font-display text-[3cqw] leading-snug text-ink/90">“…{words}”</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
