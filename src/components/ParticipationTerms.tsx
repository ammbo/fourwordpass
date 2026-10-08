import { Link } from "wouter";

/** Action-specific acknowledgement, kept in memory rather than browser storage. */
export function ParticipationTerms({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="mt-4 rounded-xl border border-line bg-paper-3 p-3 text-sm leading-relaxed text-ink-2">
      <label className="flex items-start gap-2.5">
        <input type="checkbox" required checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#17402f]" />
        <span>I’m 18 or older and agree to the <Link href="/terms" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">terms</Link>. I understand this beta uses test money.</span>
      </label>
      <p className="mt-2 text-xs text-muted">Words, notes, and pen names you submit are public. Only invite someone who agreed to receive a buck. Read the <Link href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2">privacy policy</Link> and <Link href="/beta" target="_blank" rel="noreferrer" className="underline underline-offset-2">beta guide</Link>.</p>
    </div>
  );
}
