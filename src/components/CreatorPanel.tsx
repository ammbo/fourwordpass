import { useEffect, useState } from "react";
import type { CreatorView, PublicBill } from "../../shared/types";
import { checkFinale, maskEmail } from "../../shared/words";
import { api } from "../api";
import { RepassDesk } from "./ContributePanel";
import { WordInput } from "./WordInput";
import { ParticipationTerms } from "./ParticipationTerms";

/** The finale returns to whoever minted the bill. AI suggests; the human writes. */
export function CreatorPanel({ bill, token }: { bill: PublicBill; token: string }) {
  const [view, setView] = useState<CreatorView | null>(null);
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [busy, setBusy] = useState<"suggest" | "end" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    api.creator(bill.serial, token).then(setView, () => setView({ valid: false }));
  }, [bill.serial, token, bill.status, bill.version]);

  const goalHit = bill.goalHops != null && bill.hopCount >= bill.goalHops;
  useEffect(() => {
    if (goalHit) setOpen(true);
  }, [goalHit]);

  if (!view?.valid) return null;
  if (bill.status === "complete" || bill.status === "eulogized") return null;
  // The first holder sent it back: it's in the creator's hands until they pick someone new.
  if (view.returnedBy && !sent) {
    return (
      <RepassDesk
        bill={bill}
        auth={{ c: token }}
        returnedBy={view.returnedBy}
        lastFailure={view.lastFailure}
        onSent={(to, recipient) => setSent(to === "wild" ? "Released into the wild." : `Passed to ${maskEmail(recipient)}.`)}
      />
    );
  }

  const suggest = async () => {
    setBusy("suggest");
    setError(null);
    try {
      setOptions((await api.suggest(bill.serial, { c: token, mode: "finale" })).options);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const end = async () => {
    const c = checkFinale(words);
    if (!c.ok) return setError(c.error!);
    if (!accepted) return setError("Confirm you're 18 or older and agree to the terms before publishing the finale.");
    setBusy("end");
    setError(null);
    try {
      await api.finale(bill.serial, token, words);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card border-gold/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="eyebrow !text-gold">Creator's key</div>
          <div className="font-display text-xl font-semibold">
            {goalHit ? `${bill.hopCount} of ${bill.goalHops} hops. The ending is yours.` : "You started this story. You get to end it."}
          </div>
          {sent && <div className="text-sm font-medium text-ink-2">{sent}</div>}
          {bill.goalHops && !goalHit && (
            <div className="text-sm text-muted">
              {bill.hopCount} of {bill.goalHops} hops so far. It can keep going as long as you like.
            </div>
          )}
        </div>
        {!open && (
          <button type="button" className="btn btn-ghost text-sm" onClick={() => setOpen(true)}>
            Write the finale
          </button>
        )}
      </div>
      {open && (
        <div className="mt-4">
          {!view.canEnd && <p className="mb-3 text-sm text-muted">It's mid-handoff right now. Give PayPal a few seconds.</p>}
          <WordInput mode="finale" value={words} onChange={setWords} placeholder="and the robot finally slept, dreaming" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost !py-2 text-sm" onClick={suggest} disabled={!!busy}>
              {busy === "suggest" ? "Thinking…" : "✦ Suggest endings"}
            </button>
            {options.map((o) => (
              <button key={o} type="button" className="chip !py-1.5 !text-sm hover:!border-ink" onClick={() => setWords(o)}>
                {o}
              </button>
            ))}
          </div>
          {error && <div className="mt-3 text-sm font-medium text-serial">{error}</div>}
          <ParticipationTerms checked={accepted} onChange={setAccepted} />
          <button type="button" className="btn btn-primary mt-4" onClick={end} disabled={!!busy || !view.canEnd}>
            {busy === "end" ? "Ending…" : "End the story"}
          </button>
          <p className="mt-2 text-xs text-muted">Up to 12 words that count. This closes the story for good; followers get the ending.</p>
        </div>
      )}
    </section>
  );
}
