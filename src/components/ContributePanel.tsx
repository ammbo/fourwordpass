import { useEffect, useRef, useState } from "react";
import type { HolderView, PublicBill } from "../../shared/types";
import { checkFourWords, isEmail, maskEmail } from "../../shared/words";
import { api } from "../api";
import { FollowBox } from "./FollowBox";
import { ShareButton } from "./ShareButton";
import { WordInput } from "./WordInput";
import { ParticipationTerms } from "./ParticipationTerms";

type Props = { bill: PublicBill; token: string; onDone: () => void };

const placeText = (p: { city: string | null; region: string | null; country: string | null }) =>
  p.city ? `${p.city}${p.region && p.country === "US" ? `, ${p.region}` : ""}` : p.country ?? null;

/** Email link → read → four words → pass. The whole loop, built to take under a minute on a phone. */
export function ContributePanel({ bill, token, onDone }: Props) {
  const [view, setView] = useState<HolderView | null>(null);
  const [sentTo, setSentTo] = useState<"wild" | "someone" | null>(null);
  const [landed, setLanded] = useState(false);
  const prevState = useRef<string | null>(null);

  // Poll faster while money is moving.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const v = await api.holder(bill.serial, token);
        if (!alive) return;
        if ((prevState.current === "in_transit" || sentTo === "someone") && v.state === "moved_on") setLanded(true);
        prevState.current = v.state;
        setView(v);
      } catch {
        /* keep last view */
      }
    };
    tick();
    const fast = view?.state === "in_transit" || view?.state === "arriving";
    const id = setInterval(tick, fast ? 2000 : 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill.serial, token, view?.state, bill.version]);

  if (!view) return <PanelShell><div className="h-40 animate-pulse-soft rounded-xl bg-paper-2" /></PanelShell>;

  if (landed || sentTo === "wild") {
    return (
      <PanelShell tone="done">
        <div className="eyebrow !text-paper/70">{bill.serial}</div>
        <h2 className="mt-1 font-display text-3xl font-semibold">{sentTo === "wild" ? "Released into the wild." : "Landed. Your words are in."}</h2>
        <p className="mt-2 text-paper/80">
          {sentTo === "wild"
            ? "The first stranger to claim it gets the dollar and the next four words."
            : "PayPal confirmed the payout, so the story moved. You're part of it now."}
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <FollowBox serial={bill.serial} compact dark />
          <ShareButton serial={bill.serial} dark />
        </div>
      </PanelShell>
    );
  }

  switch (view.state) {
    case "invalid":
    case "moved_on":
      return (
        <PanelShell>
          <p className="font-display text-xl">This buck has moved on.</p>
          <p className="mt-1 text-muted">That link belonged to an earlier holder. The story's still below.</p>
        </PanelShell>
      );
    case "ended":
      return null;
    case "arriving":
      return (
        <PanelShell>
          <div className="eyebrow">Claimed · {bill.serial}</div>
          <h2 className="mt-1 font-display text-3xl font-semibold">Your dollar is on its way.</h2>
          <FlyingBill />
          <PayPalStatus status={view.paypalStatus} mode={view.mode} />
          <p className="mt-2 text-sm text-muted">The moment PayPal confirms it, this turns into your writing desk. We'll email you the link too.</p>
        </PanelShell>
      );
    case "in_transit":
      return (
        <PanelShell>
          <div className="eyebrow">{bill.serial}</div>
          <h2 className="mt-1 font-display text-3xl font-semibold">Sent. {bill.serial} is on its way.</h2>
          <p className="mt-1 text-muted">
            Heading to <b className="text-ink">{view.recipient}</b>. Your words, “{view.words}”, join the story the moment the dollar lands.
          </p>
          <FlyingBill />
          <PayPalStatus status={view.paypalStatus} mode={view.mode} />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <FollowBox serial={bill.serial} compact />
            <ShareButton serial={bill.serial} />
          </div>
        </PanelShell>
      );
    case "holding":
      return (
        <WritingDesk
          bill={bill}
          token={token}
          view={view}
          onSent={(to, words, recipient) => {
            setSentTo(to);
            if (to === "someone") {
              // Show the in-flight state immediately; polling takes over from here.
              prevState.current = "in_transit";
              setView({ state: "in_transit", recipient: maskEmail(recipient), paypalStatus: "PENDING", mode: "sandbox", words });
            }
            onDone();
          }}
        />
      );
  }
}

function WritingDesk({ bill, token, view, onSent }: { bill: PublicBill; token: string; view: Extract<HolderView, { state: "holding" }>; onSent: (to: "wild" | "someone", words: string, recipient: string) => void }) {
  const [words, setWords] = useState(view.lastFailure?.words ?? "");
  const [toWild, setToWild] = useState(false);
  const [next, setNext] = useState("");
  const [note, setNote] = useState("");
  const [penName, setPenName] = useState("");
  const [showCity, setShowCity] = useState(true);
  const [more, setMore] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [left, setLeft] = useState(view.suggestionsLeft);
  const [suggesting, setSuggesting] = useState(false);
  const [aiAssisted, setAiAssisted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(view.lastFailure ? `PayPal couldn't deliver to ${view.lastFailure.recipient}. Pick someone else, or release it into the wild.` : null);
  const input = useRef<HTMLInputElement>(null);

  const tail = bill.hops.slice(-6).map((h) => h.words).join(" ");
  const place = placeText(view.place);
  const check = checkFourWords(words);

  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const r = await api.suggest(bill.serial, { t: token });
      setOptions(r.options);
      setLeft(r.left ?? 0);
      if (!r.options.length) setError("The buck drew a blank. Your call.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  };

  const submit = async () => {
    setTouched(true);
    if (!check.ok) return setError(check.error!);
    if (!toWild && !isEmail(next)) return setError("Who's next? Add their email, or release it into the wild.");
    if (!accepted) return setError("Confirm you're 18 or older and agree to the terms before passing.");
    setBusy(true);
    setError(null);
    try {
      await api.contribute(bill.serial, { t: token, words, next: toWild ? null : next, note: note || undefined, penName: penName || undefined, showCity, aiAssisted });
      onSent(toWild ? "wild" : "someone", words.trim(), next.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelShell>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="eyebrow">You're holding {bill.serial}</div>
        {view.viaWild && <div className="chip !border-violet-300 !bg-violet-50 text-violet-900">Claimed from the wild · 24h to write</div>}
      </div>
      <h2 className="mt-1 font-display text-[1.9rem] font-semibold leading-tight">
        {bill.serial} is yours. Add four words.
      </h2>
      <p className="mt-1 text-muted">
        {bill.hopCount} {bill.hopCount === 1 ? "stranger has" : "strangers have"} written this so far.
        {bill.followerCount > 1 && <> <b className="text-ink">{bill.followerCount} people are watching.</b></>}
      </p>

      <div className="mt-4 rounded-xl border border-line bg-paper-2/50 px-4 py-3 font-display text-lg leading-relaxed">
        {tail ? <span className="text-muted">…{tail} </span> : <span className="text-muted italic">{bill.theme ? `Prompt: “${bill.theme}.” ` : ""}You're writing the first words. </span>}
        <span className={words.trim() ? "rounded bg-[#f3dd8a] px-1 text-ink" : "animate-pulse-soft text-ink/40"}>{words.trim() || "▍"}</span>
      </div>

      <div className="mt-4">
        <WordInput ref={input} value={words} onChange={(v) => { setWords(v); setError(null); }} autoFocus touched={touched} placeholder="your four words go here" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost !py-2 text-sm" onClick={suggest} disabled={suggesting || left <= 0}>
          {suggesting ? "Thinking…" : "✦ Suggest 4 words"}
        </button>
        {left < 5 && <span className="text-xs text-muted">{left} left</span>}
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className="chip !py-1.5 !text-sm hover:!border-ink"
            onClick={() => {
              setWords(o);
              setAiAssisted(true);
              input.current?.focus();
            }}
          >
            {o}
          </button>
        ))}
      </div>

      <div className="mt-6">
        <div className="mb-2 font-display text-xl font-semibold">Who's next?</div>
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
          <p className="text-sm text-muted">Anyone can claim it from the Wild page. Your words land the moment you release it.</p>
        ) : (
          <input className="field" type="email" inputMode="email" autoComplete="off" value={next} onChange={(e) => setNext(e.target.value)} placeholder="next@example.com" />
        )}
      </div>

      <button type="button" className="mt-4 text-sm font-semibold text-ink-3 underline-offset-4 hover:underline" onClick={() => setMore((m) => !m)}>
        {more ? "− Fewer options" : "+ Sign it, leave a note, or hide your city"}
      </button>
      {more && (
        <div className="mt-3 space-y-3">
          <input className="field" value={penName} onChange={(e) => setPenName(e.target.value)} maxLength={24} placeholder="Pen name (optional)" />
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="A note for the bill's diary (not part of the story)" />
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[#17402f]" checked={showCity} onChange={(e) => setShowCity(e.target.checked)} />
            <span>{place ? <>Stamp this hop as <b>{place}</b></> : "Show my city"} (city-level only)</span>
          </label>
        </div>
      )}
      {!more && place && showCity && <p className="mt-1 text-xs text-muted">Your stamp will say {place}.</p>}
      <ParticipationTerms checked={accepted} onChange={setAccepted} />

      {error && <div className="mt-4 rounded-xl border border-serial/30 bg-serial/5 px-3.5 py-2.5 text-sm font-medium text-serial">{error}</div>}

      <button type="button" className="btn btn-primary mt-5 w-full !py-4 !text-lg" onClick={submit} disabled={busy}>
        {busy ? "Passing…" : toWild ? "Release the buck →" : "Pass the buck →"}
      </button>
      <p className="mt-2 text-center text-xs text-muted">
        {toWild ? "The sandbox buck waits until someone claims it." : "We send a $1 PayPal sandbox payout. Your words land when it does. Only invite a willing recipient."}
      </p>
    </PanelShell>
  );
}

function PanelShell({ children, tone }: { children: React.ReactNode; tone?: "done" }) {
  return (
    <section
      className={`animate-rise rounded-[22px] border p-5 sm:p-7 ${
        tone === "done" ? "border-ink bg-ink text-paper shadow-2xl" : "card border-ink/30 shadow-[0_20px_60px_-30px_rgba(23,64,47,.6)]"
      }`}
    >
      {children}
    </section>
  );
}

function FlyingBill() {
  return (
    <div className="relative my-5 h-14 overflow-hidden rounded-xl border border-dashed border-line bg-paper-2/60">
      <div className="absolute inset-y-2 left-0 w-24 animate-fly rounded-md border-2 border-ink bg-bill shadow">
        <div className="serial absolute left-1.5 top-1 text-[0.5rem]">$1</div>
        <div className="absolute inset-0 grid place-items-center font-display text-lg font-bold italic text-ink">4</div>
      </div>
    </div>
  );
}

function PayPalStatus({ status, mode }: { status: string | null; mode: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="h-2 w-2 animate-pulse-soft rounded-full bg-gold" />
      <span className="font-mono text-xs uppercase tracking-wider text-muted">
        PayPal {mode === "mock" ? "(simulated)" : "sandbox"} payout · {status ?? "creating"}
      </span>
    </div>
  );
}
