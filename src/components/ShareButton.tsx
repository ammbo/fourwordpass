import { useState } from "react";

export function ShareButton({ serial, dark }: { serial: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/b/${serial}`;
  const share = async () => {
    const data = { title: `${serial} on Four Word Pass`, text: `A dollar with a story, written four words at a time by strangers.`, url };
    try {
      if (navigator.share) return await navigator.share(data);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* dismissed */
    }
  };
  return (
    <button
      type="button"
      onClick={share}
      className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl border px-4 font-semibold transition ${
        dark ? "border-paper/25 hover:bg-paper/10" : "border-line bg-paper-3 hover:border-ink"
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {copied ? "Link copied" : "Share this buck"}
    </button>
  );
}
