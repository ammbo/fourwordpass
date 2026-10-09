import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Me } from "../shared/types";
import { checkPenName, isEmail } from "../shared/words";
import { type PendingAccount, api } from "./api";

type MeState = { me: Me | null; loaded: boolean; setMe: (me: Me | null) => void };
const MeContext = createContext<MeState>({ me: null, loaded: false, setMe: () => {} });

/** The signed-in account, if any. Accounts are optional, so most visitors are null here. */
export function MeProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.me().then((r) => setMe(r.me), () => {}).finally(() => setLoaded(true));
  }, []);
  return <MeContext.Provider value={{ me, loaded, setMe }}>{children}</MeContext.Provider>;
}

export const useMe = () => useContext(MeContext);

/** A proven address to send the code to, without the page ever seeing it: a holder's ticket or a creator key. */
export type SignInVia = { serial: string; ticket?: string; c?: string; email: string /* masked */ };

/** A pen name is optional, but when given it must be one an account can claim. */
export const penNameError = (value: string) => (value.trim() ? checkPenName(value).error ?? null : null);

/**
 * The optional field that turns any email someone types into an account offer. Nothing is
 * created until they tap the link (or enter the code) in the email that goes to that address.
 */
export function PenNameOffer({ value, onChange, dark, label = "Want an account too? Pick a pen name" }: {
  value: string;
  onChange: (value: string) => void;
  dark?: boolean;
  label?: string;
}) {
  const muted = dark ? "text-paper/70" : "text-muted";
  return (
    <div className="mt-3">
      <label className={`block text-sm ${dark ? "text-paper/85" : "text-ink-2"}`}>
        {label} <span className={muted}>(optional)</span>
        <input
          className={`field mt-1.5 !py-2 ${dark ? "!border-paper/30 !bg-paper/10 !text-paper placeholder:!text-paper/50" : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={24}
          placeholder="Jo March"
          autoComplete="nickname"
        />
      </label>
      <p className={`mt-1 text-xs ${muted}`}>
        {value.trim()
          ? "We'll email a link to confirm it's you. No password. Once it's yours, nobody else can sign with it."
          : "An account keeps every buck you touch in one place. No password."}
      </p>
    </div>
  );
}

/** Email → six-digit code → signed in. No passwords; the same email also carries a one-tap link. */
export function CodeSignIn({ via, next, onSignedIn, dark, startLabel = "Email me a code", askPenName, pending, defaultEmail = "" }: {
  via?: SignInVia;
  next?: string;
  onSignedIn?: (me: Me) => void;
  dark?: boolean;
  startLabel?: string;
  /** Offer the pen-name field, making this an account offer. */
  askPenName?: boolean;
  /** A code already on its way (a claim's account offer): start at the code box. */
  pending?: PendingAccount;
  defaultEmail?: string;
}) {
  const { setMe } = useMe();
  const [email, setEmail] = useState(defaultEmail);
  const [penName, setPenName] = useState(pending?.penName ?? "");
  const [typed, setTyped] = useState(!via);
  const [challenge, setChallenge] = useState<{ id: string; sentTo: string } | null>(pending ? { id: pending.challenge, sentTo: pending.sentTo } : null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (typed && !isEmail(email)) return setError("That email doesn't look right.");
    const penProblem = penNameError(penName);
    if (penProblem) return setError(penProblem);
    setBusy(true);
    setError(null);
    try {
      const pen = penName.trim() || undefined;
      const r = await api.signInStart(!typed && via ? { serial: via.serial, ticket: via.ticket, c: via.c, next, penName: pen } : { email: email.trim(), next, penName: pen });
      setChallenge({ id: r.challenge, sentTo: r.sentTo });
      setCode("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = useCallback(async (digits: string) => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const { me } = await api.signInVerify({ challenge: challenge.id, code: digits });
      setMe(me);
      onSignedIn?.(me);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }, [challenge, onSignedIn, setMe]);

  const field = `field ${dark ? "!border-paper/30 !bg-paper/10 !text-paper placeholder:!text-paper/50" : ""}`;
  const primary = `btn !py-2.5 ${dark ? "bg-paper text-ink" : "btn-primary"}`;
  const quiet = `text-sm underline-offset-4 hover:underline ${dark ? "text-paper/75" : "text-muted hover:text-ink"}`;
  const errorNote = error && <p role="alert" className={`mt-2 text-sm font-medium ${dark ? "text-[#ffb4a8]" : "text-serial"}`}>{error}</p>;

  if (challenge) {
    const digits = code.replace(/\D/g, "");
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (digits.length === 6) verify(digits); else setError("The code is six digits."); }}>
        <p className={`text-sm ${dark ? "text-paper/80" : "text-muted"}`}>
          We emailed a code to <b className={dark ? "text-paper" : "text-ink"}>{challenge.sentTo}</b>. Enter it here, or tap the link in that email.
        </p>
        <div className="mt-2.5 flex gap-2">
          <input
            className={`${field} !py-2.5 text-center font-mono text-xl tracking-[0.3em]`}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={7}
            aria-label="Six-digit code"
            placeholder="123456"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
              const d = e.target.value.replace(/\D/g, "");
              if (d.length === 6) verify(d);
            }}
          />
          <button className={`${primary} shrink-0 whitespace-nowrap`} disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
        </div>
        {errorNote}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {(via || email) && <button type="button" className={quiet} disabled={busy} onClick={() => start()}>Send another code</button>}
          <button type="button" className={quiet} onClick={() => { setChallenge(null); setTyped(true); setError(null); }}>Use a different email</button>
        </div>
      </form>
    );
  }

  if (!typed && via) {
    return (
      <div>
        {askPenName && <div className="-mt-3 mb-3"><PenNameOffer value={penName} onChange={(v) => { setPenName(v); setError(null); }} dark={dark} label="Pick a pen name" /></div>}
        <button type="button" className={`${primary} w-full`} disabled={busy} onClick={() => start()}>
          {busy ? "Sending…" : startLabel}
        </button>
        <p className={`mt-1.5 text-xs ${dark ? "text-paper/65" : "text-muted"}`}>
          We'll send it to {via.email}. <button type="button" className="underline underline-offset-2" onClick={() => setTyped(true)}>Use a different email</button>
        </p>
        {errorNote}
      </div>
    );
  }

  return (
    <form onSubmit={start}>
      <div className="flex gap-2">
        <input className={`${field} !py-2.5`} type="email" inputMode="email" autoComplete="email" aria-label="Your email" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
        <button className={`${primary} shrink-0 whitespace-nowrap`} disabled={busy}>{busy ? "Sending…" : startLabel}</button>
      </div>
      {askPenName && <PenNameOffer value={penName} onChange={(v) => { setPenName(v); setError(null); }} dark={dark} label="New here? Pick a pen name" />}
      {errorNote}
    </form>
  );
}

/** ✓ after a pen name that belongs to its writer's account. */
export function VerifiedMark({ className = "" }: { className?: string }) {
  return (
    <span className={`ml-1 inline-grid h-3.5 w-3.5 translate-y-[-1px] place-items-center rounded-full bg-ink align-middle text-[0.55rem] font-bold leading-none text-paper ${className}`} title="A claimed pen name, signed by its owner" aria-label="claimed pen name">
      ✓
    </span>
  );
}
