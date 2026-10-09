import { useState } from "react";
import type { PublicDiary } from "../../shared/types";

const PREVIEW = 3;

const KIND_MARK: Record<string, string> = { birth: "✦", hop: "→", stall: "…", wild: "⟿", goal: "★", finale: "∎", death: "✝" };

/** The bill's own voice. Always labeled; never part of the story, and quieter than it. */
export function Diary({ entries, persona }: { entries: PublicDiary[]; persona: string }) {
  const [showAll, setShowAll] = useState(false);
  if (!entries.length) return null;
  const shown = showAll ? entries : entries.slice(0, PREVIEW);
  return (
    <div>
      <p className="mb-4 text-sm text-muted">Written by {persona} itself, after every hop. AI-generated, in the bill's voice.</p>
      <ol className="space-y-5 border-l-2 border-dashed border-line pl-5">
        {shown.map((d, i) => (
          <li key={i} className="relative animate-rise">
            <span className="absolute -left-[31px] top-0.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-paper-3 text-[0.7rem] text-ink">
              {KIND_MARK[d.kind] ?? "·"}
            </span>
            <div className="font-mono text-[0.7rem] uppercase tracking-widest text-muted">{d.dayLabel}</div>
            <p className={`mt-0.5 font-display text-[1.08rem] italic leading-relaxed ${d.kind === "stall" || d.kind === "death" ? "text-serial" : "text-ink-2"}`}>
              {d.text}
            </p>
          </li>
        ))}
      </ol>
      {shown.length < entries.length && (
        <button type="button" className="btn btn-ghost mt-5 text-sm" onClick={() => setShowAll(true)}>
          Read all {entries.length} entries
        </button>
      )}
    </div>
  );
}
