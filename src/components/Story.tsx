import { Fragment } from "react";
import type { PublicBill, PublicHop } from "../../shared/types";

export type Active = { hop: number } | { place: string } | null;

export const placeKey = (h: PublicHop) => (h.lat != null && h.lng != null ? `${h.lat},${h.lng}` : null);

export function isActive(active: Active, h: PublicHop) {
  if (!active) return false;
  if ("hop" in active) return active.hop === h.idx;
  return placeKey(h) === active.place;
}

const PARAGRAPH = 12;

type Props = {
  bill: PublicBill;
  active: Active;
  onActive: (a: Active) => void;
  /** A tap or click on a line, as opposed to a hover. */
  onPick?: (idx: number) => void;
  freshIdx?: number | null;
};

export function Story({ bill, active, onActive, onPick, freshIdx }: Props) {
  const hops = bill.hops;
  const visible = hops;
  const latest = bill.history.newerAfter === null;
  const lastInherited = bill.forkedFrom ? bill.forkedFrom.atHop : null;

  if (!hops.length) {
    return (
      <p className="story-prose italic text-muted">
        Blank. The first four words are on their way{bill.theme ? `. The prompt: “${bill.theme}.”` : "."}
      </p>
    );
  }

  const paragraphs: PublicHop[][] = [];
  visible.forEach((h, i) => {
    if (i % PARAGRAPH === 0) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(h);
  });

  return (
    <div className="story-prose" onMouseLeave={() => onActive(null)}>
      {paragraphs.map((para, pi) => (
        <p key={pi} className={`mb-4 ${pi === 0 && hops[0].idx === 1 ? "dropcap" : ""}`}>
          {para.map((h) => (
            <Fragment key={h.idx}>
              <span
                role="button" tabIndex={0}
                onFocus={() => onActive({hop: h.idx})}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") {e.preventDefault(); onActive({hop: h.idx}); onPick?.(h.idx);} }}
                className="hop"
                data-active={isActive(active, h)}
                data-dim={active != null && !isActive(active, h)}
                data-inherited={h.inherited}
                data-fresh={freshIdx === h.idx}
                onMouseEnter={() => onActive({ hop: h.idx })}
                onClick={() => {
                  onActive({ hop: h.idx });
                  onPick?.(h.idx);
                }}
              >
                {h.words}
              </span>{" "}
              {lastInherited === h.idx && (
                <span className="mx-1 inline-block translate-y-[-2px] rounded-full border border-dashed border-ink/40 px-2 py-0.5 align-middle font-mono text-[0.62rem] uppercase tracking-widest text-muted">
                  ⑂ fork · new branch begins
                </span>
              )}
            </Fragment>
          ))}
          {pi === paragraphs.length - 1 && latest && bill.finale?.by === "creator" && (
            <span className="font-semibold text-ink"> {bill.finale.text}</span>
          )}
        </p>
      ))}

      {latest && bill.finale?.by === "creator" && (
        <p className="mt-2 font-mono text-xs uppercase tracking-widest text-muted">— The end, written by the one who started it.</p>
      )}

      {latest && bill.finale?.by === "bill" && (
        <div className="mt-4 rounded-xl border border-dashed border-serial/50 bg-serial/5 px-4 py-3">
          <div className="font-mono text-[0.68rem] font-semibold uppercase tracking-widest text-serial">
            The buck wrote its own ending · its creator never came back
          </div>
          <p className="mt-1 italic text-serial/90">{bill.finale.text}</p>
          <div className="mt-1 font-sans text-xs text-muted">This line is AI-written, in the bill's voice. Every word above it was written by a person.</div>
        </div>
      )}
    </div>
  );
}
