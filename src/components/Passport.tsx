import { useState } from "react";
import type { PublicHop } from "../../shared/types";
import { Stamp } from "./Stamp";
import { type Active, isActive } from "./Story";

const PAGE = 48;

export function Passport({ serial, hops, active, onActive }: { serial: string; hops: PublicHop[]; active: Active; onActive: (a: Active) => void }) {
  const [shown, setShown] = useState(PAGE);
  const ordered = [...hops].reverse();
  if (!hops.length) return <p className="text-sm text-muted">Empty passport. The first stamp prints when the first hop lands.</p>;
  return (
    <div>
      <div className="relative rounded-2xl border border-line bg-[#f7f2e4] p-4 shadow-inner [background-image:repeating-linear-gradient(0deg,transparent_0_27px,rgba(23,64,47,.05)_27px_28px)]">
        <div className="flex flex-wrap justify-center gap-x-1 gap-y-2 sm:justify-start">
          {ordered.slice(0, shown).map((h) => (
            <Stamp
              key={h.idx}
              serial={serial}
              idx={h.idx}
              place={h.place}
              date={h.confirmedAt}
              imageUrl={h.stampUrl}
              pending={h.stampStatus === "pending"}
              active={isActive(active, h)}
              size={118}
              onHover={(on) => onActive(on ? { hop: h.idx } : null)}
              onClick={() => onActive({ hop: h.idx })}
            />
          ))}
        </div>
      </div>
      {ordered.length > shown && (
        <button type="button" className="btn btn-ghost mt-3 text-sm" onClick={() => setShown((s) => s + PAGE * 2)}>
          Show more stamps ({ordered.length - shown} more)
        </button>
      )}
    </div>
  );
}
