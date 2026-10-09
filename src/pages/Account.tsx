import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import type { BillSummary, Dashboard as DashboardData, DashboardHop, FollowPreference } from "../../shared/types";
import { checkPenName } from "../../shared/words";
import { CodeSignIn, VerifiedMark, useMe } from "../account";
import { api } from "../api";
import { Stamp } from "../components/Stamp";
import { STATUS_LABEL, STATUS_TONE, longDate, nf, timeAgo } from "../lib";

/** Only same-site paths, so a crafted link can't bounce someone off the site after signing in. */
const safeNext = (next: string | null) => (next && /^\/(?![/\\])/.test(next) ? next : "/me");

export function SignIn() {
  const { me, loaded, setMe } = useMe();
  const [, navigate] = useLocation();
  // The emailed link lands here. Signing in takes a tap, so mail scanners that open links can't spend it.
  const [link] = useState(() => {
    const p = new URLSearchParams(location.search);
    return { ch: p.get("ch"), k: p.get("k"), next: safeNext(p.get("next")), pen: p.get("pen") };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (link.ch || link.k) history.replaceState(history.state, "", link.next === "/me" ? "/signin" : `/signin?next=${encodeURIComponent(link.next)}`);
  }, [link]);

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = await api.signInVerify({ challenge: link.ch!, link: link.k! });
      setMe(done.me);
      // Someone claimed the pen name first: the dashboard asks for another.
      navigate(done.penNameTaken ? "/me" : link.next);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:py-24">
      <div className="card p-6 sm:p-8">
        <div className="eyebrow">Your account</div>
        {me ? (
          <>
            <h1 className="mt-2 font-display text-3xl font-semibold">You're signed in.</h1>
            <p className="mt-2 text-muted">As <b className="text-ink">{me.email}</b>.</p>
            <Link href={link.next} className="btn btn-primary mt-6 w-full">Continue</Link>
          </>
        ) : link.ch && link.k ? (
          <>
            <h1 className="mt-2 font-display text-3xl font-semibold">{link.pen ? `Make “${link.pen}” yours.` : "One tap and you're in."}</h1>
            <p className="mt-2 text-muted">
              {link.pen
                ? "This proves the email is yours, creates your account and claims the pen name. Nobody else can sign with it after this."
                : "This link signs you in once, for 15 minutes after it was sent."}
            </p>
            <button type="button" className="btn btn-primary mt-6 w-full !py-3.5" onClick={finish} disabled={busy || !loaded}>
              {busy ? "One moment…" : link.pen ? "Create my account" : "Sign in"}
            </button>
            {error && <p role="alert" className="mt-3 text-sm font-medium text-serial">{error}</p>}
            {error && <div className="mt-6 border-t border-line pt-5"><CodeSignIn next={link.next} onSignedIn={() => navigate(link.next)} /></div>}
          </>
        ) : (
          <>
            <h1 className="mt-2 font-display text-3xl font-semibold">Sign in or sign up.</h1>
            <p className="mt-2 mb-6 text-muted">
              No password. We email you a six-digit code. If a buck has ever reached you, everything you did as “a stranger” is already waiting.
            </p>
            <CodeSignIn next={link.next} askPenName onSignedIn={() => navigate(link.next)} />
            <p className="mt-6 text-xs text-muted">
              Accounts are optional; every buck still works from its email link. <Link href="/privacy" className="underline underline-offset-2">Privacy</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function Dashboard() {
  const { me, loaded, setMe } = useMe();
  const [, navigate] = useLocation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => api.dashboard().then((d) => { setData(d); setError(null); }, (e: Error) => setError(e.message));

  useEffect(() => {
    if (me) reload();
  }, [me?.email]);

  if (!loaded) return <Shell><div className="h-64 animate-pulse-soft rounded-3xl bg-paper-2" /></Shell>;
  if (!me)
    return (
      <div className="mx-auto max-w-md px-4 py-16 sm:py-24">
        <div className="card p-6 sm:p-8">
          <div className="eyebrow">Your bucks</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Sign in to see your history.</h1>
          <p className="mt-2 mb-6 text-muted">Every buck that reached your email, every word you wrote, every story you started. Even the ones from before you had an account.</p>
          <CodeSignIn next="/me" askPenName />
        </div>
      </div>
    );

  const signOut = async () => {
    await api.signOut().catch(() => {});
    setMe(null);
    navigate("/");
  };

  return (
    <Shell>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">Your bucks</span>
            {me.isAdmin && <span className="chip !border-gold/50 !text-gold">Admin</span>}
          </div>
          <h1 className="mt-1.5 font-display text-4xl font-semibold leading-tight sm:text-5xl">
            {me.handle ? <>{me.handle}<VerifiedMark className="!h-5 !w-5 !text-xs" /></> : "A stranger, until you say otherwise."}
          </h1>
          <p className="mt-1 text-sm text-muted">{me.email} · joined {longDate(me.createdAt)}</p>
        </div>
        <button type="button" className="btn btn-ghost !py-2 text-sm" onClick={signOut}>Sign out</button>
      </header>

      {error && <p role="alert" className="mt-6 text-serial">{error} <button className="underline" onClick={reload}>Try again</button></p>}

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <PenNameCard />
        {me.isAdmin ? (
          <section className="card border-gold/50 p-5">
            <div className="eyebrow !text-gold">Admin</div>
            <div className="mt-1 font-display text-xl font-semibold">Release bucks without checkout.</div>
            <p className="mt-1 text-sm text-muted">Signed in as an admin, the release form skips PayPal. The platform funds the first payout, and Open Books lists it as comped.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/release" className="btn btn-primary !py-2 text-sm">Release a buck free</Link>
              <Link href="/books" className="btn btn-ghost !py-2 text-sm">Open books</Link>
            </div>
          </section>
        ) : (
          <section className="card p-5">
            <div className="font-display text-xl font-semibold">Start one of your own.</div>
            <p className="mt-1 text-sm text-muted">Signed in, you skip the email field, and your pen name signs the foreword.</p>
            <Link href="/release" className="btn btn-primary mt-4 !py-2 text-sm">Release a buck</Link>
          </section>
        )}
      </div>

      {!data ? (
        !error && <div className="mt-10 h-48 animate-pulse-soft rounded-3xl bg-paper-2" />
      ) : (
        <>
          <dl className="mt-10 grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
            {([
              [data.stats.hops, data.stats.hops === 1 ? "hop written" : "hops written"],
              [data.stats.words, "words"],
              [data.stats.held, data.stats.held === 1 ? "buck held" : "bucks held"],
              [data.stats.started, "started"],
              [data.stats.places, data.stats.places === 1 ? "place" : "places"],
            ] as const).map(([n, label]) => (
              <div key={label} className="rounded-xl border border-line bg-paper-3 py-3">
                <dd className="font-display text-2xl font-semibold leading-none">{nf(n)}</dd>
                <dt className="mt-1 font-mono text-[0.62rem] uppercase tracking-widest text-muted">{label}</dt>
              </div>
            ))}
          </dl>

          {data.inHand.length > 0 && (
            <Section title="Waiting on you" note="Bucks in your hands right now. No email link needed while you're signed in.">
              <div className="grid gap-3 sm:grid-cols-2">
                {data.inHand.map((b) => (
                  <BillLine key={b.serial} bill={b} highlight action={{ write: "Add your 4 words →", repass: "It came back. Pick someone new →", arriving: "Your dollar is on its way →" }[b.action]} />
                ))}
              </div>
            </Section>
          )}

          <Section title="Your words" note="Every hop you've written, signed or as a stranger. Only you see this list; the stories show what you chose to sign.">
            {data.hops.length ? <HopList hops={data.hops} /> : (
              <Empty>No words yet. <Link href="/wild" className="font-semibold underline underline-offset-4">Claim a buck from the wild</Link> and write the next four.</Empty>
            )}
          </Section>

          <Section title="Stories you started" note="You hold the creator's key to each: you write the finale.">
            {data.started.length ? (
              <div className="grid gap-3 sm:grid-cols-2">{data.started.map((b) => <BillLine key={b.serial} bill={b} />)}</div>
            ) : (
              <Empty>None yet. <Link href="/release" className="font-semibold underline underline-offset-4">Release a buck</Link> to start one.</Empty>
            )}
          </Section>

          <Section title="Following" note="Email updates, sent to your account's address.">
            {data.following.length ? <FollowList follows={data.following} onChange={reload} /> : <Empty>You're not following any bucks. Every bill page has a follow box.</Empty>}
          </Section>
        </>
      )}
    </Shell>
  );
}

function PenNameCard() {
  const { me, setMe } = useMe();
  const [editing, setEditing] = useState(!me?.handle);
  const [name, setName] = useState(me?.handle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = checkPenName(name);
    if (!check.ok) return setError(check.error!);
    setBusy(true);
    setError(null);
    try {
      setMe((await api.claimPenName(check.name)).me);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card p-5">
      <div className="font-display text-xl font-semibold">Your pen name</div>
      {editing ? (
        <form onSubmit={save}>
          <p className="mt-1 text-sm text-muted">Claim one and it's yours: nobody else can sign with it, and your hops show a <VerifiedMark className="!translate-y-0" /> beside it. You can still write as a stranger any time.</p>
          <div className="mt-3 flex gap-2">
            <input className="field !py-2.5" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} maxLength={24} placeholder="Jo March" aria-label="Pen name" autoFocus={!!me?.handle} />
            <button className="btn btn-primary shrink-0 !py-2.5" disabled={busy}>{busy ? "Claiming…" : me?.handle ? "Save" : "Claim it"}</button>
          </div>
          {error && <p role="alert" className="mt-2 text-sm font-medium text-serial">{error}</p>}
          {me?.handle && <button type="button" className="mt-2 text-sm text-muted underline-offset-4 hover:underline" onClick={() => { setEditing(false); setName(me.handle!); setError(null); }}>Keep {me.handle}</button>}
        </form>
      ) : (
        <>
          <p className="mt-1 font-display text-2xl">{me?.handle}<VerifiedMark /></p>
          <p className="mt-1 text-sm text-muted">Signs your words when you're signed in. Hops you already signed keep their name if you change it.</p>
          <button type="button" className="mt-3 text-sm font-semibold underline-offset-4 hover:underline" onClick={() => setEditing(true)}>Change it</button>
        </>
      )}
    </section>
  );
}

function HopList({ hops }: { hops: DashboardHop[] }) {
  const [, navigate] = useLocation();
  const [shown, setShown] = useState(24);
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {hops.slice(0, shown).map((h) => (
          <li key={`${h.serial}:${h.idx}`} className="card flex items-center gap-3 p-3">
            <div className="shrink-0">
              <Stamp serial={h.serial} idx={h.idx} place={h.place} date={h.confirmedAt} imageUrl={h.stampUrl} pending={h.stampStatus === "pending"} size={76} onClick={() => navigate(`/b/${h.serial}`)} />
            </div>
            <div className="min-w-0">
              <Link href={`/b/${h.serial}`} className="font-display text-lg leading-snug hover:underline">“{h.words}”</Link>
              <div className="mt-0.5 text-xs text-muted">
                {h.opening ? "The foreword" : `Hop ${nf(h.idx)}`} of <span className="serial !tracking-wider">{h.serial}</span> · {h.personaName}
              </div>
              <div className="text-xs text-muted">
                {h.place} · {timeAgo(h.confirmedAt)} · {h.penName ? <>signed <b className="text-ink">{h.penName}</b>{h.penVerified && <VerifiedMark />}</> : "as a stranger"}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {hops.length > shown && (
        <button type="button" className="btn btn-ghost mt-3 text-sm" onClick={() => setShown((n) => n + 48)}>Show more ({hops.length - shown} more)</button>
      )}
    </>
  );
}

function FollowList({ follows, onChange }: { follows: DashboardData["following"]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const set = async (id: string, preference: FollowPreference | "unfollow") => {
    setBusy(id);
    try {
      await api.myFollow(id, preference);
      onChange();
    } finally {
      setBusy(null);
    }
  };
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-paper-3">
      {follows.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href={`/b/${f.serial}`} className="min-w-0">
            <span className="serial text-sm">{f.serial}</span> <span className="font-display">{f.personaName}</span>
            <span className={`chip ml-2 !py-0.5 !text-[0.68rem] ${STATUS_TONE[f.status]}`}>{STATUS_LABEL[f.status]}</span>
          </Link>
          <div className="flex gap-1 rounded-full border border-line bg-paper-2 p-0.5 text-xs font-semibold" role="group" aria-label={`Emails about ${f.serial}`}>
            {(["every_hop", "on_end", "unfollow"] as const).map((p) => (
              <button
                key={p}
                type="button"
                disabled={busy === f.id}
                onClick={() => set(f.id, p)}
                aria-pressed={f.preference === p}
                className={`rounded-full px-2.5 py-1.5 transition ${f.preference === p ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
              >
                {p === "every_hop" ? "Every hop" : p === "on_end" ? "When it ends" : "Stop"}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function BillLine({ bill, action, highlight }: { bill: BillSummary; action?: string; highlight?: boolean }) {
  return (
    <Link href={`/b/${bill.serial}`} className={`card block p-4 transition hover:-translate-y-0.5 hover:shadow-xl ${highlight ? "border-ink/40" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="serial text-sm">{bill.serial}</span>
        <span className={`chip !py-0.5 !text-[0.68rem] ${STATUS_TONE[bill.status]}`}>{STATUS_LABEL[bill.status]}</span>
      </div>
      <div className="mt-1 font-display text-xl font-semibold">{bill.personaName}</div>
      <p className="mt-1 line-clamp-2 font-display text-[0.98rem] leading-snug text-ink/80">
        {bill.teaser ? `“…${bill.teaser}”` : <span className="italic text-muted">Waiting for its first words.</span>}
      </p>
      <div className="mt-2 font-mono text-[0.68rem] uppercase tracking-wider text-muted">
        {nf(bill.hopCount)} hops · {nf(bill.followerCount)} watching · {timeAgo(bill.createdAt)}
      </div>
      {action && <div className="mt-3 text-sm font-semibold text-ink">{action}</div>}
    </Link>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-3xl font-semibold">{title}</h2>
      <p className="mb-4 text-sm text-muted">{note}</p>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">{children}</p>;
const Shell = ({ children }: { children: React.ReactNode }) => <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:pt-12">{children}</div>;
