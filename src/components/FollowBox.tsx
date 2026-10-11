import { profileSchema, type ProfileName } from "../../shared/names";
import { useState } from "react";
import { Link } from "wouter";
import type { FollowPreference, HolderTicket } from "../../shared/types";
import { isEmail } from "../../shared/words";
import { CodeSignIn, PenNameOffer, penNameError, useMe } from "../account";
import { api } from "../api";

/**
 * Follow with just an email. Default is "only when it ends": every-hop is opt-in enthusiasm.
 * A proven address follows in one tap: the signed-in account, or, with a holder's ticket, the
 * address the buck was passed to. Holders can turn that into an account right here, optionally.
 */
export function FollowBox({ serial, compact, dark, ticket }: { serial: string; compact?: boolean; dark?: boolean; ticket?: HolderTicket | null }) {
  const { me } = useMe();
  const [email, setEmail] = useState("");
  const [typed, setTyped] = useState(false);
  // Someone who just wrote in it wants to see what comes next.
  const [pref, setPref] = useState<FollowPreference>(ticket ? "every_hop" : "on_end");
  const [state, setState] = useState<"idle" | "busy" | "done" | "confirm">("idle");
  const [joining, setJoining] = useState(false);
  // Typing your email is a chance to make an account: one emailed tap confirms both.
  const [penName, setPenName] = useState("");
  const [profile, setProfile] = useState<ProfileName>({ firstName: "", lastName: "" });
  const [offered, setOffered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const as = typed ? "email" : me ? "account" : ticket ? "ticket" : "email";

  const follow = async (who: "email" | "account" | "ticket") => {
    if (who === "email" && !isEmail(email)) return setError("That email doesn't look right.");
    const pen = who === "email" && !me ? penName.trim() : "";
    if (pen && !profileSchema.safeParse(profile).success) return setError("Enter your first name so recipients recognize you.");
    if (pen && penNameError(pen)) return setError(penNameError(pen));
    setState("busy");
    setError(null);
    try {
      const r = await api.follow(serial, who === "email" ? { email, ...(pen ? { penName: pen, ...profile } : {}) } : who === "ticket" ? { ticket: ticket!.token } : {}, pref);
      setOffered(r.account ? pen : null);
      setState(r.verified ? "done" : "confirm");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  };

  const muted = dark ? "text-paper/70" : "text-muted";
  const shell = `rounded-xl border p-3.5 ${dark ? "border-paper/25" : "border-line bg-paper-3"}`;
  const link = "font-semibold underline underline-offset-4";

  if (state === "confirm")
    return (
      <div className={`${shell} text-sm`}>
        <b>Check your inbox.</b>{" "}
        <span className={muted}>
          {offered
            ? `One tap in that email confirms your follow and creates your account as “${offered}”.`
            : `Confirm your email preference to follow ${serial}. If you previously opted out, use your original preferences link.`}
        </span>
      </div>
    );

  if (state === "done")
    return (
      <div className={`${shell} text-sm`}>
        <b>Following {pref === "every_hop" ? "every hop" : "until it ends"}.</b>{" "}
        {me ? (
          <span className={muted}>It's in <Link href="/me" className={link}>your dashboard</Link>, with everything else you've touched.</span>
        ) : ticket ? (
          <>
            <span className={muted}>Want every buck you touch in one place, and a pen name nobody else can use? Make it an account. No password.</span>
            <div className="mt-6"><CodeSignIn via={{ serial, ticket: ticket.token, email: ticket.email }} dark={dark} startLabel="Create my account" askPenName /></div>
          </>
        ) : (
          <span className={muted}>Every email has a link to change or stop it.</span>
        )}
      </div>
    );

  return (
    <div className={shell}>
      {!compact && <div className="mb-1 font-display text-lg font-semibold">Follow this buck</div>}
      <div className={`mb-2 text-sm ${muted}`}>{compact ? `Follow ${serial}:` : me ? "Updates go to your account's email." : "No account. Just an email."}</div>
      <div className="mb-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {(["on_end", "every_hop"] as const).map((p) => (
          <label key={p} className="flex items-center gap-1.5">
            <input type="radio" name={`pref-${serial}`} checked={pref === p} onChange={() => setPref(p)} className={dark ? "accent-[#f4efe2]" : "accent-[#17402f]"} />
            {p === "on_end" ? "Only when it ends" : "Every hop"}
          </label>
        ))}
      </div>
      {joining && ticket ? (
        <div className="mt-3"><CodeSignIn via={{ serial, ticket: ticket.token, email: ticket.email }} dark={dark} startLabel="Email me a code" askPenName onSignedIn={() => follow("account")} /></div>
      ) : as === "email" ? (
        <form onSubmit={(e) => { e.preventDefault(); follow("email"); }}>
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
          {!me && <PenNameOffer profile={profile} onProfileChange={setProfile} value={penName} onChange={(v) => { setPenName(v); setError(null); }} dark={dark} />}
        </form>
      ) : (
        <button type="button" className={`btn w-full !py-2.5 text-sm ${dark ? "bg-paper text-ink" : "btn-primary"}`} disabled={state === "busy"} onClick={() => follow(as)}>
          {state === "busy" ? "Following…" : as === "account" ? "Follow" : `Follow as ${ticket!.email}`}
        </button>
      )}
      {!joining && (
        <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs ${muted}`}>
          {as !== "email" && <button type="button" className="underline underline-offset-2" onClick={() => setTyped(true)}>Use a different email</button>}
          {as === "ticket" && <button type="button" className="underline underline-offset-2" onClick={() => setJoining(true)}>Or follow with an account</button>}
        </div>
      )}
      {as === "email" && !joining && (
        <p className={`mt-2 text-xs ${muted}`}>Follow requests email updates for this story. Every update includes a stop link. <Link href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2">Privacy</Link> · <Link href="/support" target="_blank" rel="noreferrer" className="underline underline-offset-2">Help</Link></p>
      )}
      {error && <div className={`mt-2 text-sm ${dark ? "text-[#ffb4a8]" : "text-serial"}`}>{error}</div>}
    </div>
  );
}
