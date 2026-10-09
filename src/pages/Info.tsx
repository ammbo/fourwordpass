import { paymentNotice } from "../../shared/payments";
import { usePaymentMode } from "../paymentMode";
import { useLocation } from "wouter";
import { INFO_PAGES, POLICY_DATE } from "../../shared/info";

export function Info() {
  const [path] = useLocation();
  const mode = usePaymentMode();
  const page = INFO_PAGES[path];
  return (
    <article className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:pt-16">
      <header>
        <div className="eyebrow">{page.eyebrow}</div>
        <h1 className="mt-3 font-display text-4xl font-semibold leading-tight sm:text-5xl">{page.heading}</h1>
        <p className="mt-4 text-sm text-muted">Effective {POLICY_DATE}</p>
        <p className="mt-4 rounded-xl border border-line p-3 text-sm">{paymentNotice(mode)} {mode !== "sandbox" && "The guide below describes the sandbox beta; live payments remain paused."}</p>
        <p className="mt-5 text-lg leading-relaxed text-ink-2">{page.intro}</p>
      </header>
      <nav className="mt-8 rounded-2xl border border-line bg-paper-3 p-5" aria-label="On this page">
        <div className="eyebrow">On this page</div>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {page.sections.map((section) => <li key={section.id}><a href={`#${section.id}`} className="underline-offset-4 hover:underline">{section.title}</a></li>)}
        </ul>
      </nav>
      <div className="policy-copy mt-10 space-y-9">
        {page.sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-24" aria-labelledby={`heading-${section.id}`}>
            <h2 id={`heading-${section.id}`} className="font-display text-2xl font-semibold">{section.title}</h2>
            <div className="mt-3 leading-relaxed text-ink-2" dangerouslySetInnerHTML={{ __html: section.html }} />
          </section>
        ))}
      </div>
    </article>
  );
}
