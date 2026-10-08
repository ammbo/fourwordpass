import type { PublicDiary } from "../../shared/types";

const KIND_MARK: Record<string, string> = { birth: "✦", hop: "→", stall: "…", wild: "⟿", goal: "★", finale: "∎", death: "✝" };

/** The bill's own voice. Always labeled; never part of the story. */
export function Diary({ entries, persona }: { entries: PublicDiary[]; persona: string }) {
  if (!entries.length) return null;
  return (
    <div>
      <p className="mb-4 text-sm text-muted">Written by {persona} itself, after every hop. AI-generated, in the bill's voice.</p>
      <ol className="space-y-5 border-l-2 border-dashed border-line pl-5">
        {entries.map((d, i) => (
          <li key={i} className="relative animate-rise">
            <span className="absolute -left-[31px] top-0.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-paper-3 text-[0.7rem] text-ink">
              {KIND_MARK[d.kind] ?? "·"}
            </span>
            <div className="font-mono text-[0.7rem] uppercase tracking-widest text-muted">{d.dayLabel}</div>
            <p className={`mt-0.5 font-display text-[1.08rem] italic leading-relaxed ${d.kind === "stall" || d.kind === "death" ? "text-serial" : "text-ink"}`}>
              {d.text}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
