import { useState } from "react";
import { Modal } from "./Modal";

const isDesktop = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

export function ShareButton({ serial, dark }: { serial: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const url = `${location.origin}/b/${serial}`;
  const title = `${serial} on Four Word Pass`;
  const text = `A dollar with a story, written four words at a time by strangers.`;
  const share = async () => {
    if (isDesktop()) return setOpen(true);
    try {
      if (navigator.share) return await navigator.share({ title, text, url });
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* dismissed */
    }
  };
  return (
    <>
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
      {open && <ShareDialog url={url} title={title} text={text} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ url, title, text, onClose }: { url: string; title: string; text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const u = encodeURIComponent(url), t = encodeURIComponent(text), s = encodeURIComponent(title);
  const targets = [
    { name: "X", href: `https://x.com/intent/post?text=${t}&url=${u}` },
    { name: "Bluesky", href: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text} ${url}`)}` },
    { name: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { name: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { name: "Reddit", href: `https://www.reddit.com/submit?url=${u}&title=${s}` },
    { name: "Email", href: `mailto:?subject=${s}&body=${encodeURIComponent(`${text}\n\n${url}`)}` },
  ];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <Modal title="Share this buck" onClose={onClose}>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Link to this buck"
          className="min-h-[48px] min-w-0 flex-1 rounded-xl border border-line bg-paper-3 px-3 font-mono text-sm"
        />
        <button type="button" onClick={copy} className="min-h-[48px] shrink-0 rounded-xl border border-ink bg-ink px-4 font-semibold text-paper">
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {targets.map(({ name, href }) => (
          <a
            key={name}
            href={href}
            target={name === "Email" ? undefined : "_blank"}
            rel="noopener noreferrer"
            className="flex min-h-[48px] items-center justify-center rounded-xl border border-line bg-paper-3 px-3 font-semibold transition hover:border-ink"
          >
            {name}
          </a>
        ))}
      </div>
    </Modal>
  );
}
