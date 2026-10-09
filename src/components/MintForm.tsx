import { payoutDescription } from "../../shared/payments";
import { useState } from "react";
import { useLocation } from "wouter";
import { checkFourWords, isEmail } from "../../shared/words";
import { api, useLoad, type MintBody } from "../api";
import { Checkout } from "./Checkout";
import { WordInput } from "./WordInput";
import { ParticipationTerms } from "./ParticipationTerms";

type Props = { fork?: { serial: string; atHop: number; tail: string } };

const GOALS = [null, 10, 25, 50, 100];

export function MintForm({ fork }: Props) {
  const [, navigate] = useLocation();
  const { data: config, error: configError, reload: reloadConfig } = useLoad(api.config, []);
  type PendingMint = {body: MintBody; fork?: {serial: string; atHop: number}};
  const [pending, setPending] = useState<PendingMint | null>(() => {
    try { return JSON.parse(localStorage.getItem("fwp:pending-mint") ?? "null") as PendingMint | null; } catch { return null; }
  });
  const [checkoutKey] = useState(() => crypto.randomUUID());
  const [recovering, setRecovering] = useState(false);
  const [words, setWords] = useState("");
  const [theme, setTheme] = useState("");
  const [toWild, setToWild] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [goal, setGoal] = useState<number | null>(fork ? null : 25);
  const [email, setEmail] = useState("");
  const [penName, setPenName] = useState("");
  const [showCity, setShowCity] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const validate = () => {
    setTouched(true);
    const w = checkFourWords(words);
    if (!w.ok) return w.error!;
    if (!toWild && !isEmail(recipient)) return "Who gets it first? Add their email, or release it into the wild.";
    if (!isEmail(email)) return "We need your email for your creator key.";
    if (!toWild && recipient.trim().toLowerCase() === email.trim().toLowerCase()) return "Send it to someone else. That's the whole game.";
    if (!accepted) return "Confirm you're 18 or older and agree to the terms before checkout.";
    setError(null);
    return null;
  };

  const finishPaid = async (attempt: PendingMint) => {
    setRecovering(true); setError(null);
    try {
      const out = attempt.fork
        ? await api.fork(attempt.fork.serial, {...attempt.body, atHop: attempt.fork.atHop})
        : await api.mint(attempt.body);
      try { localStorage.removeItem("fwp:pending-mint"); } catch { /* private browsing */ }
      setPending(null);
      navigate(`/b/${out.serial}?c=${out.creatorToken}&new=1`);
    } catch (e) {
      setError(`${(e as Error).message} Your checkout is saved. Retry finishing it below before starting another payment.`);
    } finally { setRecovering(false); }
  };
  const onPaid = async (orderId: string) => {
    const attempt = pending?.body.orderId === orderId ? pending : {
      body: {orderId, recoveryKey: checkoutKey, creatorEmail: email, words, theme: fork ? null : theme || null,
        goal: fork ? null : goal, firstRecipient: toWild ? null : recipient, penName: penName || null, showCity},
      fork: fork ? {serial: fork.serial, atHop: fork.atHop} : undefined,
    };
    setPending(attempt);
    try { localStorage.setItem("fwp:pending-mint", JSON.stringify(attempt)); } catch { /* retain in memory */ }
    await finishPaid(attempt);
  };

  return (
    <div className="space-y-7">
      <section>
        <label className="mb-2 block font-display text-xl font-semibold">
          {fork ? `Your four words, picking up after hop ${fork.atHop}` : "The foreword: your first four words"}
        </label>
        {fork && <p className="mb-3 font-display text-lg italic text-muted">“…{fork.tail}”</p>}
        <WordInput value={words} onChange={setWords} autoFocus touched={touched} placeholder={fork ? "but the robot refused" : "once a lonely robot"} />
      </section>

      {!fork && (
        <section>
          <label className="mb-2 block font-display text-xl font-semibold">
            What's it about? <span className="text-base font-normal text-muted">optional</span>
          </label>
          <input aria-label="Story prompt" className="field" value={theme} onChange={(e) => setTheme(e.target.value)} maxLength={140} placeholder="a robot learning to dream" />
          <p className="mt-1.5 text-sm text-muted">A prompt for strangers. The bill's personality grows out of it too.</p>
        </section>
      )}

      <section>
        <label className="mb-2 block font-display text-xl font-semibold">Who gets it first?</label>
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-full border border-line bg-paper-2 p-1">
          {[false, true].map((wild) => (
            <button
              key={String(wild)}
              type="button"
              onClick={() => setToWild(wild)}
              className={`rounded-full px-3 py-2 text-sm font-semibold transition ${toWild === wild ? "bg-ink text-paper shadow" : "text-muted"}`}
            >
              {wild ? "Release to the wild" : "Send to someone"}
            </button>
          ))}
        </div>
        {toWild ? (
          <p className="text-sm text-muted">It'll appear on the Wild page. The first stranger to claim it gets the dollar and the next four words.</p>
        ) : (
          <>
            <input className="field" type="email" inputMode="email" autoComplete="off" aria-label="First recipient email" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="friend@example.com" />
            <p className="mt-1.5 text-sm text-muted">{payoutDescription(config?.paypalMode)} They receive a real email from the bill. Invite someone who agreed to receive it.</p>
          </>
        )}
      </section>

      {!fork && (
        <section>
          <label className="mb-2 block font-display text-xl font-semibold">
            A goal? <span className="text-base font-normal text-muted">just for motivation</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {GOALS.map((g) => (
              <button
                key={String(g)}
                type="button"
                onClick={() => setGoal(g)}
                className={`chip !px-3.5 !py-1.5 !text-sm ${goal === g ? "!border-ink !bg-ink !text-paper" : ""}`}
              >
                {g ? `${g} hops` : "No goal"}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-sm text-muted">No limit either way. Hitting the goal invites you to write the finale.</p>
        </section>
      )}

      <section className="space-y-3">
        <label className="block font-display text-xl font-semibold">You</label>
        <input className="field" type="email" inputMode="email" autoComplete="email" aria-label="Your creator email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <p className="-mt-1 text-sm text-muted">For your creator key: you write the ending. Never shown publicly.</p>
        <input aria-label="Your pen name (optional)" className="field" value={penName} onChange={(e) => setPenName(e.target.value)} maxLength={24} placeholder="Pen name (optional)" />
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[#17402f]" checked={showCity} onChange={(e) => setShowCity(e.target.checked)} />
          <span>
            Stamp it with my city{config?.place ? <> (<b>{config.place}</b>)</> : null}. City-level only.
          </span>
        </label>
      </section>

      <section>
        <ParticipationTerms checked={accepted} onChange={setAccepted} />
        {error && <div className="mb-3 rounded-xl border border-serial/30 bg-serial/5 px-3.5 py-2.5 text-sm font-medium text-serial">{error}</div>}
        {configError && <p role="alert" className="mb-3 text-sm text-serial">Checkout is unavailable. {configError} <button type="button" className="underline" onClick={reloadConfig}>Try again</button></p>}
        {pending ? <div className="rounded-xl border border-line p-4">
          <p className="mb-3 text-sm">A checkout is waiting to finish. This reuses the approved order and its saved words.</p>
          <button type="button" className="btn btn-primary" disabled={recovering} onClick={() => finishPaid(pending)}>{recovering ? "Finishing…" : "Finish saved checkout"}</button>
        </div> : <Checkout recoveryKey={checkoutKey} config={config} purpose={fork ? "fork" : "mint"} validate={validate} onPaid={onPaid} onError={setError} />}
      </section>
    </div>
  );
}
