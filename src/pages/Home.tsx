import { paymentNotice, payoutDescription } from "../../shared/payments";
import { usePaymentMode } from "../paymentMode";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, useLoad } from "../api";
import { Banknote } from "../components/Banknote";
import { BillCard } from "../components/BillCard";
import { nf } from "../lib";
import { faqForMode } from "../../shared/site";

const DEMO_LINES = [
  "the robot learned to dream tonight",
  "a stranger kept the receipt",
  "then the lighthouse blinked twice",
  "nobody ordered the second pie",
];

export function Home() {
  const mode = usePaymentMode();
  const { data, error, reload } = useLoad(api.home, []);
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
          <div className="eyebrow">One dollar · a story by strangers</div>
          <h1 className="mt-3 font-display text-[3.1rem] font-semibold leading-[0.95] tracking-tight sm:text-7xl">
            Passage of the <span className="italic text-ink-3">Buck.</span>
          </h1>
          <p className="mt-5 font-display text-[1.45rem] italic leading-snug text-ink-2 sm:text-[1.7rem]">
            Pass the buck. Write a story. Four words at a time.
          </p>
          <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink-2">
            A dollar travels from person to person through PayPal. Each holder adds exactly four words to the story it carries, then passes it on.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/release" className="btn btn-primary !px-6 !py-3.5 !text-base">Start a story · $2</Link>
            <Link href="/wild" className="btn btn-ghost !px-6 !py-3.5 !text-base">Join a story · free</Link>
          </div>
          <p className="mt-3 text-sm text-muted">No account, no app. About sixty seconds.</p>
          <p className="mt-2 max-w-lg text-xs leading-relaxed text-muted">{paymentNotice(mode)}</p>
        </div>
        <div>
          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-[40px] bg-[radial-gradient(closest-side,rgba(169,123,28,.18),transparent)]" />
            <Link href={hero ? `/b/${hero.serial}` : "/release"} className="block transition hover:-rotate-1">
              <Banknote serial={hero?.serial ?? "FWP-0001"} persona={hero?.personaName ?? "Dolores the Restless"} words={words} hops={hero?.hopCount ?? 12} tilt={2.5} />
            </Link>
            <div className="absolute -bottom-5 left-6 right-10 -z-10 h-full rotate-[-5deg] rounded-[3.5%] border-2 border-ink/30 bg-bill/70" />
          </div>
          {hero && (
            <Link href={`/b/${hero.serial}`} className="mt-10 block text-center text-sm font-semibold text-ink underline-offset-4 hover:underline">
              Read the story this buck carries →
            </Link>
          )}
        </div>
      </section>

      {error && <p role="alert" className="mx-auto max-w-6xl px-4 text-serial">Stories couldn’t load. {error} <button className="underline" onClick={reload}>Try again</button></p>}
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

      <p className="mt-3 text-center text-xs text-muted">
        Counters include labeled demo histories during the beta. Every real dollar in and out is in the <Link href="/books" className="font-semibold text-ink underline-offset-4 hover:underline">open books</Link>.
      </p>

      {/* ---------------------------------------------------------------- how it works */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-display text-3xl font-semibold sm:text-4xl">How the buck moves</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            ["01", "Write the foreword", "Start a story for $2: one dollar rides with the bill, one keeps the lights on. You write the first four words, then send it to someone or release it to the wild, a public list where any stranger can claim it."],
            ["02", "Add four words", "Whoever holds it adds exactly four words that count. Little words like the, a, to and of ride free, so grammar still works. AI can suggest; you choose what goes in."],
            ["03", "Pass the buck", `Name the next holder by email, or release it to the wild. ${payoutDescription(mode)} When it lands, your words join the story.`],
          ].map(([n, t, d]) => (
            <div key={n} className="card p-6">
              <div className="serial text-sm">{n}</div>
              <div className="mt-2 font-display text-2xl font-semibold">{t}</div>
              <p className="mt-2 leading-relaxed text-ink-2">{d}</p>
            </div>
          ))}
        </div>
        <div className="eyebrow mt-10">AI plays the bill, never the author</div>
        <div className="mt-3 grid gap-5 md:grid-cols-3">
          {[
            ["The Diary", "Every bill has a personality and keeps a diary in its own voice, one entry per hop. It's never part of the story."],
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

      {/* ---------------------------------------------------------------- the long game */}
      <section className="mx-auto max-w-3xl px-4 pb-16 text-center">
        <p className="font-display text-[1.4rem] italic leading-snug text-ink-2 sm:text-3xl">
          There's no page limit. One buck could pass through ten thousand hands: forty thousand words by strangers who never met, four at a time.
        </p>
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
      <section id="faq" className="mx-auto max-w-3xl px-4 pb-20" aria-labelledby="faq-title">
        <div className="eyebrow">Good questions</div>
        <h2 id="faq-title" className="mt-2 font-display text-3xl font-semibold sm:text-4xl">A few words before you go.</h2>
        <div className="mt-6 divide-y divide-line border-y border-line">
          {faqForMode(mode).map(({ question, answer }) => (
            <details key={question} className="group py-5">
              <summary className="cursor-pointer font-display text-xl font-semibold">{question}</summary>
              <p className="mt-3 leading-relaxed text-ink-2">{answer}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
