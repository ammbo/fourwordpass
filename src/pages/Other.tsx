import { paymentNotice, payoutDescription } from "../../shared/payments";
import { usePaymentMode } from "../paymentMode";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import type { FollowPreference } from "../../shared/types";
import { api, useLoad } from "../api";
import { BillCard } from "../components/BillCard";
import { MintForm } from "../components/MintForm";


export function Release() {
  const mode = usePaymentMode();
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-24 pt-8 sm:pt-12 lg:grid-cols-[1fr_380px]">
      <div className="card p-5 sm:p-8">
        <div className="eyebrow">Release a buck</div>
        <h1 className="mt-2 font-display text-4xl font-semibold leading-tight">Write the foreword.</h1>
        <p className="mt-2 mb-8 text-muted">Four words to start it, $2 to send it on its way. Strangers write the story. You write the finale.</p>
        <p className="mb-5 rounded-xl border border-line bg-paper-2 p-3 text-sm text-ink-2">{paymentNotice(mode)}</p>
        <MintForm />
      </div>
      <aside className="space-y-4 lg:pt-4">
        {[
          ["Exactly four words", "Four words that count. The, a, an, and, or, but, to, of, in, on, at, for, with, by, from, as, is, was, are, were, be, been, it, its, this, that and then ride free."],
          ["A dollar carries the story", `Of your $2, one dollar rides with the bill and one keeps the lights on. ${payoutDescription(mode)} When it lands, the story moves.`],
          ["It has a personality", "Your bill is born with a voice. It keeps a diary, collects passport stamps, and nags anyone who sits on it."],
          ["You hold the ending", "Set a goal if you like. Whenever you're ready, you write the finale: up to twelve words."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl border border-dashed border-line p-5">
            <div className="font-display text-lg font-semibold">{t}</div>
            <p className="mt-1 text-sm leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </aside>
    </div>
  );
}

export function Wild() {
  const { data, error, reload } = useLoad(api.wild, []);
  const [, navigate] = useLocation();
  useEffect(() => {
    const id = setInterval(reload, 10_000);
    return () => clearInterval(id);
  }, [reload]);
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:pt-12">
      <div className="eyebrow">The wild</div>
      <h1 className="mt-2 font-display text-4xl font-semibold sm:text-5xl">Bucks nobody named.</h1>
      <p className="mt-2 max-w-2xl text-lg text-muted">
        Released into the wild by their last holder. The first stranger to claim one gets the dollar and the next four words. Claim it and don't write within 24 hours, and it wanders off again.
      </p>
      {error && <p role="alert" className="mt-6 text-serial">{error} <button className="underline" onClick={reload}>Try again</button></p>}
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((b) => (
          <BillCard
            key={b.serial}
            bill={b}
            action={
              <button type="button" className="btn btn-primary w-full" onClick={() => navigate(`/b/${b.serial}`)}>
                Read it and claim it
              </button>
            }
          />
        ))}
      </div>
      {data && !data.length && (
        <div className="card mt-6 p-10 text-center">
          <div className="font-display text-2xl font-semibold">The wild is quiet.</div>
          <p className="mt-2 text-muted">Every buck is in someone's pocket right now. Release one yourself.</p>
          <Link href="/release" className="btn btn-primary mt-5">Release a buck</Link>
        </div>
      )}
    </div>
  );
}

export function FollowManage() {
  const { id } = useParams<{ id: string }>();
  const [t] = useState(() => new URLSearchParams(location.search).get("t") ?? "");
  const { data, error, reload } = useLoad(() => api.followGet(id, t), [id, t]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const set = async (p: FollowPreference | "unfollow") => {
    setBusy(true); setSaveError(null);
    try {
    await api.followSet(id, t, p);
    reload();
    setSaved(p === "unfollow" ? "You've unfollowed. No more emails about this one." : p === "every_hop" ? "Every hop it is." : "Only when it ends.");
    } catch (e) {setSaveError((e as Error).message);} finally {setBusy(false);}
  };
  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <div className="card p-7">
        {error ? (
          <p>{error}</p>
        ) : !data ? (
          <div className="h-24 animate-pulse-soft rounded-xl bg-paper-2" />
        ) : (
          <>
            <div className="serial text-sm">{data.serial}</div>
            <h1 className="mt-1 font-display text-3xl font-semibold">{data.verified ? "Your emails from this buck" : "Confirm your emails from this buck"}</h1>
            <div className="mt-6 space-y-2">
              {(["every_hop", "on_end", "unfollow"] as const).map((p) => (
                <button key={p} type="button" className={`btn w-full ${(data.verified && data.preference === p) || (!data.verified && p === "unfollow") ? "btn-primary" : "btn-ghost"}`} disabled={busy} onClick={() => set(p)}>
                  {p === "every_hop" ? "Every hop" : p === "on_end" ? "Only when it ends" : "Stop all emails about it"}
                </button>
              ))}
            </div>
            {saveError && <p role="alert" className="mt-3 text-serial">{saveError}</p>}
            {saved && <p className="mt-4 text-sm font-medium">{saved}</p>}
            {data.serial && <Link href={`/b/${data.serial}`} className="mt-6 inline-block text-sm font-semibold underline-offset-4 hover:underline">Back to {data.serial}</Link>}
          </>
        )}
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <div className="serial">404</div>
      <h1 className="mt-2 font-display text-4xl font-semibold">This page got passed along.</h1>
      <Link href="/" className="btn btn-primary mt-6">Home</Link>
    </div>
  );
}
