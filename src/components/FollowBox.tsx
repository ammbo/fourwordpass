import { useState } from "react";
import { Link } from "wouter";
import type { FollowPreference } from "../../shared/types";
import { isEmail } from "../../shared/words";
import { api } from "../api";

/** Follow with just an email. Default is "only when it ends": every-hop is opt-in enthusiasm. */
export function FollowBox({ serial, compact, dark }: { serial: string; compact?: boolean; dark?: boolean }) {
  const [email, setEmail] = useState("");
  const [pref, setPref] = useState<FollowPreference>("on_end");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) return setError("That email doesn't look right.");
    setState("busy");
    setError(null);
    try {
      await api.follow(serial, email, pref);
      setState("done");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  };

  const muted = dark ? "text-paper/70" : "text-muted";
  if (state === "done")
    return (
      <div className={`rounded-xl border p-3.5 text-sm ${dark ? "border-paper/25" : "border-line bg-paper-3"}`}>
        <b>You're following {serial}.</b> <span className={muted}>{pref === "every_hop" ? "Every hop lands in your inbox." : "You'll hear when it ends."}</span>
      </div>
    );

  return (
    <form onSubmit={submit} className={`rounded-xl border p-3.5 ${dark ? "border-paper/25" : "border-line bg-paper-3"}`}>
      {!compact && <div className="mb-1 font-display text-lg font-semibold">Follow this buck</div>}
      <div className={`mb-2 text-sm ${muted}`}>{compact ? `Follow ${serial}:` : "No account. Just an email."}</div>
      <div className="flex gap-2">
        <input
          className={`field !py-2 ${dark ? "!border-paper/30 !bg-paper/10 !text-paper placeholder:!text-paper/50" : ""}`}
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-label="Email to follow this bill"
        />
        <button className={`btn !px-4 !py-2 text-sm ${dark ? "bg-paper text-ink" : "btn-primary"}`} disabled={state === "busy"}>
          Follow
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {(["on_end", "every_hop"] as const).map((p) => (
          <label key={p} className="flex items-center gap-1.5">
            <input type="radio" name={`pref-${serial}`} checked={pref === p} onChange={() => setPref(p)} className={dark ? "accent-[#f4efe2]" : "accent-[#17402f]"} />
            {p === "on_end" ? "Only when it ends" : "Every hop"}
          </label>
        ))}
      </div>
      <p className={`mt-2 text-xs ${muted}`}>Follow requests email updates for this story. Every update includes a stop link. <Link href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2">Privacy</Link> · <Link href="/support" target="_blank" rel="noreferrer" className="underline underline-offset-2">Help</Link></p>
      {error && <div className="mt-2 text-sm text-serial">{error}</div>}
    </form>
  );
}
