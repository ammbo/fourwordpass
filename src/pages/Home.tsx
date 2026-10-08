import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, useLoad } from "../api";
import { Banknote } from "../components/Banknote";
import { BillCard } from "../components/BillCard";
import { nf } from "../lib";

const DEMO_LINES = [
  "the robot learned to dream tonight",
  "a stranger kept the receipt",
  "then the lighthouse blinked twice",
  "nobody ordered the second pie",
];

export function Home() {
  const { data } = useLoad(api.home, []);
  const [line, setLine] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLine((l) => l + 1), 3200);
    return () => clearInterval(id);
  }, []);

  const hero = data?.featured[0] ?? data?.recent[0];
  const words = hero?.teaser ? hero.teaser.split(" ").slice(-6).join(" ") : DEMO_LINES[line % DEMO_LINES.length];

  return (
    <div>
      {/* ---------------------------------------------------------------- hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-10 sm:pt-16 md:grid-cols-[1.1fr_1fr]">
        <div className="animate-rise">
          <div className="eyebrow">A real dollar · a story by strangers</div>
          <h1 className="mt-3 font-display text-[3.1rem] font-semibold leading-[0.95] tracking-tight sm:text-7xl">
            Passage of the <span className="italic text-ink-3">Buck.</span>
          </h1>
          <p className="mt-5 font-display text-[1.45rem] italic leading-snug text-ink-2 sm:text-[1.7rem]">
            Pass the buck. Write a story. Four words at a time.
          </p>
          <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink-2">
            A real dollar travels hand to hand through PayPal. Each holder adds exactly four words to the story it carries, then passes it on. The bill keeps a diary.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/release" className="btn btn-primary !px-6 !py-3.5 !text-base">Release a buck · $2</Link>
            <Link href="/wild" className="btn btn-ghost !px-6 !py-3.5 !text-base">Claim one from the wild</Link>
          </div>
          <p className="mt-3 text-sm text-muted">Holders play free. No account, no app. About sixty seconds.</p>
        </div>
        <div className="relative">
          <div className="absolute -inset-6 -z-10 rounded-[40px] bg-[radial-gradient(closest-side,rgba(169,123,28,.18),transparent)]" />
          <Link href={hero ? `/b/${hero.serial}` : "/release"} className="block transition hover:-rotate-1">
            <Banknote serial={hero?.serial ?? "FWP-0001"} persona={hero?.personaName ?? "Dolores the Restless"} words={words} hops={hero?.hopCount ?? 12} tilt={2.5} />
          </Link>
          <div className="absolute -bottom-5 left-6 right-10 -z-10 h-full rotate-[-5deg] rounded-[3.5%] border-2 border-ink/30 bg-bill/70" />
        </div>
      </section>

      {/* ---------------------------------------------------------------- live counters */}
      <section className="border-y border-line bg-paper-3/60">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 sm:grid-cols-4">
          {[
            [data?.stats.traveling, "bills traveling"],
            [data?.stats.words, "words written"],
            [data?.stats.hops, "hands touched"],
            [data?.stats.cities, "cities stamped"],
          ].map(([n, l]) => (
            <div key={l as string} className="py-6 text-center">
              <div className="font-display text-4xl font-semibold tabular-nums">{n == null ? "—" : nf(n as number)}</div>
              <div className="mt-1 font-mono text-[0.68rem] uppercase tracking-widest text-muted">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- how it works */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-display text-3xl font-semibold sm:text-4xl">How the buck moves</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            ["01", "Write the foreword", "Release a buck for $2: one dollar rides with the bill, one keeps the lights on. You write the first four words and pick who gets it first, or set it loose in the wild."],
            ["02", "Add four words", "Whoever holds it adds exactly four words that count. Little words like the, a, to and of ride free, so grammar still works. AI can suggest; it never writes."],
            ["03", "Pass the buck", "Name the next person by email or release it to the wild. PayPal sends them a real dollar. When the payout lands, your words join the story."],
          ].map(([n, t, d]) => (
            <div key={n} className="card p-6">
              <div className="serial text-sm">{n}</div>
              <div className="mt-2 font-display text-2xl font-semibold">{t}</div>
              <p className="mt-2 leading-relaxed text-ink-2">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {[
            ["The Diary", "Every bill has a personality and writes a first-person diary entry after each hop."],
            ["The Passport", "Each hop prints a stamp: city, date, and a little ink illustration."],
            ["The Nag", "Sit on a bill and it gets needy at 24 hours, dramatic at 3 days, and writes its own eulogy at 14."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-dashed border-line p-5">
              <div className="font-display text-lg font-semibold">{t}</div>
              <p className="mt-1 text-sm leading-relaxed text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- bills */}
      {data && data.featured.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-14">
          <h2 className="mb-5 font-display text-3xl font-semibold">Featured bills</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.featured.map((b) => <BillCard key={b.serial} bill={b} />)}
          </div>
        </section>
      )}
      {data && data.recent.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-14">
          <h2 className="mb-5 font-display text-3xl font-semibold">On the move</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.recent.map((b) => <BillCard key={b.serial} bill={b} />)}
          </div>
        </section>
      )}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="card flex flex-col items-start justify-between gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
          <div>
            <div className="eyebrow">The wild</div>
            <div className="mt-1 font-display text-2xl font-semibold">
              {data?.wild.length ? `${data.wild.length} ${data.wild.length === 1 ? "buck is" : "bucks are"} waiting for a stranger.` : "Bills nobody named go here. First to claim gets the dollar."}
            </div>
            {data?.wild[0]?.teaser && <p className="mt-1 font-display italic text-muted">“…{data.wild[0].teaser}”</p>}
          </div>
          <Link href="/wild" className="btn btn-primary shrink-0">Go to the wild</Link>
        </div>
      </section>
    </div>
  );
}
