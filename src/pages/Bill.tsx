import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import type { PublicBill, PublicHop } from "../../shared/types";
import { isEmail } from "../../shared/words";
import { api, useLiveBill, useUrlToken } from "../api";
import { Banknote } from "../components/Banknote";
import { ContributePanel } from "../components/ContributePanel";
import { CreatorPanel } from "../components/CreatorPanel";
import { Diary } from "../components/Diary";
import { FollowBox } from "../components/FollowBox";
import { MintForm } from "../components/MintForm";
import { Modal } from "../components/Modal";
import { Passport } from "../components/Passport";
import { ShareButton } from "../components/ShareButton";
import { type Active, Story, placeKey } from "../components/Story";
import { TrailMap } from "../components/TrailMap";
import { STATUS_LABEL, STATUS_TONE, age, longDate, nf, timeAgo } from "../lib";
import { billMeta, pageMeta, SITE_URL } from "../../shared/site";
import { updateMetadata } from "../components/PageMetadata";
import { ParticipationTerms } from "../components/ParticipationTerms";

export function BillPage() {
  const { serial: raw } = useParams<{ serial: string }>();
  const serial = raw.toUpperCase();
  const { bill, error, refresh } = useLiveBill(serial);
  const [holderToken, setHolderToken] = useUrlToken("t", serial, "session");
  const [creatorToken] = useUrlToken("c", serial, "local");
  const [isNew] = useState(() => new URLSearchParams(location.search).has("new"));
  const [active, setActive] = useState<Active>(null);
  const [forkAt, setForkAt] = useState<PublicHop | null>(null);
  // Phones stack the inspector below the whole story, so a tapped line opens a sheet instead.
  const [picked, setPicked] = useState<number | null>(null);
  const [claiming, setClaiming] = useState(false);
  const fresh = useFreshHop(bill);

  useEffect(() => {
    if (bill) updateMetadata(billMeta({
      serial: bill.serial, name: bill.personality.name, hopCount: bill.hopCount,
      teaser: bill.hops.slice(-6).map((h) => h.words).join(" "), createdAt: bill.createdAt,
      modifiedAt: Math.max(bill.createdAt, bill.endedAt ?? 0, ...bill.hops.map((h) => h.confirmedAt)), isSeed: bill.isSeed,
    }));
  }, [bill]);

  useEffect(() => {
    if (error && !bill) updateMetadata({ ...pageMeta(`/b/${serial}`), title: "Bill not found · Four Word Pass", heading: "No bill by that serial.", noindex: true });
  }, [error, bill, serial]);

  if (error && !bill)
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <div className="serial text-lg">{serial}</div>
        <h1 className="mt-2 font-display text-4xl font-semibold">No bill by that serial.</h1>
        <p className="mt-3 text-muted">Check the number on the note, or go find one in the wild.</p>
        <Link href="/wild" className="btn btn-primary mt-6">Browse the wild</Link>
      </div>
    );
  if (!bill) return <div className="mx-auto max-w-6xl px-4 py-10"><div className="h-64 animate-pulse-soft rounded-3xl bg-paper-2" /></div>;

  const last = bill.hops[bill.hops.length - 1];
  const activeHop = active && "hop" in active ? bill.hops.find((h) => h.idx === active.hop) : null;
  const pickedHop = picked == null ? null : bill.hops.find((h) => h.idx === picked);
  const activeKey = activeHop ? placeKey(activeHop) : active && "place" in active ? active.place : null;
  const ended = bill.status === "complete" || bill.status === "eulogized";
  const lastWords = bill.hops.slice(-2).map((h) => h.words).join(" ");

  return (
    <article className="h-entry mx-auto max-w-6xl px-4 pb-24 pt-6 sm:pt-10">
      <a className="u-url sr-only" href={`${SITE_URL}/b/${bill.serial}`}>Story permalink</a>
      {holderToken && !ended && (
        <div className="mb-8">
          <ContributePanel bill={bill} token={holderToken} onDone={refresh} />
        </div>
      )}

      {isNew && (
        <div className="animate-rise mb-6 rounded-2xl border border-ink bg-ink p-5 text-paper">
          <div className="font-display text-2xl font-semibold">It's alive. Meet {bill.personality.name}.</div>
          <p className="mt-1 text-paper/80">
            {bill.status === "wild" ? "It's loose in the wild, waiting to be claimed." : "It's on its way to its first holder."} We emailed you your creator key: it's how you'll write the ending.
          </p>
          <div className="mt-4 max-w-xs"><ShareButton serial={bill.serial} dark /></div>
        </div>
      )}

      {creatorToken && (
        <div className="mb-8">
          <CreatorPanel bill={bill} token={creatorToken} />
        </div>
      )}

      {/* ---------------------------------------------------------------- header */}
      <header className="grid items-center gap-8 md:grid-cols-[1.05fr_1fr]">
        <Banknote serial={bill.serial} persona={bill.personality.name} words={lastWords} hops={bill.hopCount} tilt={-1.5} muted={bill.status === "eulogized"} />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="serial text-sm">{bill.serial}</span>
            <span className={`chip ${STATUS_TONE[bill.status]}`}>
              {bill.status === "in_transit" && <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-amber-600" />}
              {STATUS_LABEL[bill.status]}
            </span>
            {bill.featured && <span className="chip !border-gold/40 !text-gold">★ Featured</span>}
            {bill.isSeed && <span className="chip !text-muted" title="This bill's early history was simulated for the demo.">Demo history</span>}
          </div>
          <div className="eyebrow mt-4 text-balance">A story by strangers, four words at a time</div>
          <h1 className="p-name mt-1.5 font-display text-4xl font-semibold leading-[1.05] sm:text-5xl">{bill.personality.name}</h1>
          <p className="mt-2 font-display text-lg italic text-ink-2">
            “{bill.personality.tagline}” <span className="whitespace-nowrap font-sans text-xs not-italic text-muted">the bill's motto, by AI</span>
          </p>
          {bill.theme && <p className="mt-2 text-sm text-muted">Prompt: {bill.theme}</p>}

          <dl className="mt-5 grid grid-cols-4 gap-2 text-center">
            {[
              [nf(bill.hopCount), "hops"],
              [nf(bill.wordCount), "words"],
              [nf(bill.followerCount), "watching"],
              [String(new Set(bill.hops.map((h) => h.place)).size), "places"],
            ].map(([n, l]) => (
              <div key={l} className="rounded-xl border border-line bg-paper-3 py-2.5">
                <dt className="sr-only">{l}</dt>
                <dd className="font-display text-2xl font-semibold leading-none">{n}</dd>
                <div className="mt-1 font-mono text-[0.62rem] uppercase tracking-widest text-muted">{l}</div>
              </div>
            ))}
          </dl>
          {bill.goalHops && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-muted">
                <span>Goal: {bill.goalHops} hops</span>
                <span>{Math.min(100, Math.round((bill.hopCount / bill.goalHops) * 100))}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper-2">
                <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${Math.min(100, (bill.hopCount / bill.goalHops) * 100)}%` }} />
              </div>
            </div>
          )}
          <p className="mt-4 text-sm text-muted">
            Released {bill.originCity ? `in ${bill.originCity} ` : ""}on <time className="dt-published" dateTime={new Date(bill.createdAt).toISOString()}>{longDate(bill.createdAt)}</time> · {age(bill.createdAt)}
            {bill.status === "holding" && bill.holderSince && <> · in someone's pocket{bill.holderPlace ? ` near ${bill.holderPlace}` : ""} for {timeAgo(bill.holderSince).replace(" ago", "")}</>}
            {bill.status === "wild" && bill.wildSince && <> · in the wild for {timeAgo(bill.wildSince).replace(" ago", "")}</>}
            {" · "}<Link href={`/books?bill=${bill.serial}`} className="font-semibold text-ink underline-offset-4 hover:underline">Its PayPal ledger</Link>
          </p>
          {bill.forkedFrom && (
            <p className="mt-2 text-sm">
              ⑂ Forked from <Link href={`/b/${bill.forkedFrom.serial}`} className="serial underline-offset-4 hover:underline">{bill.forkedFrom.serial}</Link> at hop {bill.forkedFrom.atHop}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {bill.status === "wild" && !holderToken && (
              <button type="button" className="btn btn-primary" onClick={() => setClaiming(true)}>Claim this buck</button>
            )}
            <div className="min-w-[180px] flex-1"><ShareButton serial={bill.serial} /></div>
          </div>
          {bill.status === "holding" && !holderToken && <ResendLink serial={bill.serial} />}
        </div>
      </header>

      {/* ---------------------------------------------------------------- eulogy */}
      {bill.status === "eulogized" && bill.eulogy && (
        <section className="mt-12 rounded-3xl border border-stone-300 bg-stone-100/70 p-6 text-center sm:p-10">
          <div className="eyebrow">In memoriam · {bill.serial}</div>
          <p className="mx-auto mt-3 max-w-2xl font-display text-2xl italic leading-relaxed text-stone-700">{bill.eulogy}</p>
          <div className="mt-3 text-xs text-muted">A eulogy written by the bill itself (AI), after 14 days without moving.</div>
        </section>
      )}

      {/* ---------------------------------------------------------------- story + map */}
      <section className="mt-14 grid gap-8 lg:grid-cols-[1.35fr_1fr]">
        <div>
          <div className="mb-4 flex items-end justify-between gap-4 border-b border-line pb-3">
            <div>
              <h2 className="font-display text-3xl font-semibold">The Story</h2>
              <p className="text-sm text-muted">Pay it ForWord: {bill.hopCount} strangers, four words at a time. Tap any line to see who wrote it, and where.</p>
            </div>
          </div>
          <div className="e-content"><Story bill={bill} active={active} onActive={setActive} onPick={setPicked} freshIdx={fresh} /></div>
        </div>
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="font-display text-xl font-semibold">The Passage</h3>
            <span className="text-xs text-muted">Every pin is a pair of hands</span>
          </div>
          <TrailMap hops={bill.hops} activeKey={activeKey} onHoverKey={(k) => setActive(k ? { place: k } : null)} className="h-72 sm:h-80" />
          <Inspector bill={bill} hop={activeHop ?? (active ? null : last)} placeKey={active && "place" in active ? active.place : null} onFork={setForkAt} />
          {!holderToken && !ended && (
            <div className="mt-4"><FollowBox serial={bill.serial} /></div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- passport + diary */}
      <section className="mt-16 grid gap-10 lg:grid-cols-[1fr_1.3fr]">
        <div>
          <h2 className="mb-1 font-display text-3xl font-semibold">The Diary</h2>
          <Diary entries={bill.diary} persona={bill.personality.name} />
        </div>
        <div>
          <h2 className="mb-1 font-display text-3xl font-semibold">The Passport</h2>
          <p className="mb-4 text-sm text-muted">One stamp per hop. Illustrations are inked by AI from each hop's place and words.</p>
          <Passport serial={bill.serial} hops={bill.hops} active={active} onActive={setActive} />
        </div>
      </section>

      {/* ---------------------------------------------------------------- family tree */}
      {(bill.forks.length > 0 || bill.forkedFrom) && <FamilyTree bill={bill} />}

      {pickedHop && (
        <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto max-w-xl lg:hidden *:mt-0 *:shadow-2xl">
          <Inspector bill={bill} hop={pickedHop} placeKey={null} onFork={(h) => { setPicked(null); setForkAt(h); }} onClose={() => setPicked(null)} />
        </div>
      )}

      {forkAt && (
        <Modal title={`Fork ${bill.serial} at hop ${forkAt.idx}`} onClose={() => setForkAt(null)}>
          <p className="mb-5 text-muted">
            Didn't like where it went? Start a new bill that carries this story up to hop {forkAt.idx}, then takes it somewhere else. You become its creator.
          </p>
          <MintForm
            fork={{
              serial: bill.serial,
              atHop: forkAt.idx,
              tail: bill.hops.filter((h) => h.idx <= forkAt.idx).slice(-6).map((h) => h.words).join(" "),
            }}
          />
        </Modal>
      )}

      {claiming && (
        <ClaimModal
          serial={bill.serial}
          onClose={() => setClaiming(false)}
          onClaimed={(t) => {
            setHolderToken(t);
            setClaiming(false);
            window.scrollTo({ top: 0, behavior: "smooth" });
            refresh();
          }}
        />
      )}
    </article>
  );
}

function Inspector({ bill, hop, placeKey: pk, onFork, onClose }: { bill: PublicBill; hop: PublicHop | null | undefined; placeKey: string | null; onFork: (h: PublicHop) => void; onClose?: () => void }) {
  if (pk) {
    const at = bill.hops.filter((h) => `${h.lat},${h.lng}` === pk);
    return (
      <div className="card mt-3 p-4">
        <div className="font-display text-lg font-semibold">{at[0]?.place}</div>
        <div className="text-sm text-muted">{at.length} hop{at.length === 1 ? "" : "s"} written here: {at.slice(0, 12).map((h) => h.idx).join(", ")}{at.length > 12 ? "…" : ""}</div>
      </div>
    );
  }
  if (!hop) return null;
  return (
    <div className="card mt-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-xs uppercase tracking-widest text-muted">
          {hop.idx === 1 ? "Hop 1 · the foreword" : `Hop ${hop.idx}`}{hop.inherited ? " · inherited" : ""}
        </div>
        <div className="flex items-center gap-3">
          <div className="font-mono text-xs text-muted">{longDate(hop.confirmedAt)}</div>
          {onClose && <button type="button" className="-my-1 -mr-1 px-1 text-lg leading-none text-muted hover:text-ink" onClick={onClose} aria-label="Close">×</button>}
        </div>
      </div>
      <div className="mt-1 font-display text-xl">“{hop.words}”</div>
      <div className="mt-1 text-sm text-muted">{hop.penName ? <><b className="text-ink">{hop.penName}</b> in {hop.place}</> : `A stranger in ${hop.place}`}</div>
      {hop.note && <div className="mt-2 rounded-lg bg-paper-2 px-3 py-2 text-sm italic">Note to the bill: {hop.note}</div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {hop.receipt ? (
          <span className="chip !font-mono !text-[0.68rem] !font-medium" title="The PayPal payout that put this bill in the writer's hands">
            <span className="text-[#003087]">Pay</span><span className="-ml-1.5 text-[#0070e0]">Pal</span>
            {hop.receipt.mode === "sandbox" ? "sandbox" : hop.receipt.mode === "mock" ? "simulated" : "demo"} payout {hop.receipt.item} · {hop.receipt.status}
          </span>
        ) : <span />}
        <button type="button" className="text-sm font-semibold text-ink-3 underline-offset-4 hover:underline" onClick={() => onFork(hop)}>
          ⑂ Fork from here
        </button>
      </div>
    </div>
  );
}

function FamilyTree({ bill }: { bill: PublicBill }) {
  return (
    <section className="mt-16">
      <h2 className="font-display text-3xl font-semibold">Family tree</h2>
      <p className="mb-4 text-sm text-muted">Stories split. Every branch chases its own ending.</p>
      <div className="card overflow-x-auto p-5">
        <div className="flex min-w-max items-center gap-4 font-mono text-sm">
          {bill.forkedFrom && (
            <>
              <Link href={`/b/${bill.forkedFrom.serial}`} className="chip !px-3 !py-1.5 hover:!border-ink">{bill.forkedFrom.serial}</Link>
              <span className="text-muted">— hop {bill.forkedFrom.atHop} →</span>
            </>
          )}
          <span className="chip !border-ink !bg-ink !px-3 !py-1.5 !text-paper">{bill.serial}</span>
          {bill.forks.length > 0 && (
            <div className="ml-2 flex flex-col gap-2 border-l-2 border-dashed border-line pl-4">
              {bill.forks.map((f) => (
                <div key={f.serial} className="flex items-center gap-2">
                  <span className="text-muted">hop {f.atHop} ⑂</span>
                  <Link href={`/b/${f.serial}`} className="chip !px-3 !py-1.5 hover:!border-ink">{f.serial}</Link>
                  <span className="text-xs text-muted">{f.hopCount} hops · {STATUS_LABEL[f.status]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {bill.forks.length > 0 && (
          <p className="mt-3 font-sans text-sm text-muted">
            This story forked {bill.forks.length} way{bill.forks.length === 1 ? "" : "s"}
            {new Set(bill.forks.map((f) => f.atHop)).size === 1 ? ` at hop ${bill.forks[0].atHop}` : ""}.
          </p>
        )}
      </div>
    </section>
  );
}

function ClaimModal({ serial, onClose, onClaimed }: { serial: string; onClose: () => void; onClaimed: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) return setError("We need your PayPal email to send you the dollar.");
    if (!accepted) return setError("Confirm you're 18 or older and agree to the terms before claiming.");
    setBusy(true);
    setError(null);
    try {
      onClaimed((await api.claim(serial, email)).token);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={`Claim ${serial}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-muted">We'll send a $1 sandbox test payout to your email. No real money changes hands. When the handoff lands, you add four words and pass it on. You have 24 hours before it wanders back into the wild.</p>
        <input className="field mt-4" type="email" inputMode="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your PayPal email" />
        <ParticipationTerms checked={accepted} onChange={setAccepted} />
        {error && <div className="mt-3 text-sm font-medium text-serial">{error}</div>}
        <button className="btn btn-primary mt-4 w-full !py-3.5" disabled={busy}>{busy ? "Claiming…" : "Claim it"}</button>
        <p className="mt-2 text-center text-xs text-muted">Look for the email from Four Word Pass. PayPal sandbox notifications do not reach ordinary inboxes.</p>
      </form>
    </Modal>
  );
}

function ResendLink({ serial }: { serial: string }) {
  const [sent, setSent] = useState(false);
  return (
    <p className="mt-3 text-sm text-muted">
      {sent ? (
        "If you're holding it, your link is on its way."
      ) : (
        <>
          Holding this one and only got PayPal's email?{" "}
          <button type="button" className="font-semibold text-ink underline-offset-4 hover:underline" onClick={() => api.resend(serial).then(() => setSent(true))}>
            Email me my link
          </button>
        </>
      )}
    </p>
  );
}

/** Highlight a hop that lands while you're watching. */
function useFreshHop(bill: PublicBill | null): number | null {
  const prev = useRef<number | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const lastIdx = useMemo(() => (bill?.hops.length ? bill.hops[bill.hops.length - 1].idx : 0), [bill]);
  useEffect(() => {
    if (prev.current != null && lastIdx > prev.current) {
      setFresh(lastIdx);
      const t = setTimeout(() => setFresh(null), 5000);
      prev.current = lastIdx;
      return () => clearTimeout(t);
    }
    prev.current = lastIdx;
  }, [lastIdx]);
  return fresh;
}
