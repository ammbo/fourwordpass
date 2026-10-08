import { useState } from "react";
import { useLocation } from "wouter";
import { checkFourWords, isEmail } from "../../shared/words";
import { api, useLoad } from "../api";
import { Checkout } from "./Checkout";
import { WordInput } from "./WordInput";

type Props = { fork?: { serial: string; atHop: number; tail: string } };

const GOALS = [null, 10, 25, 50, 100];

export function MintForm({ fork }: Props) {
  const [, navigate] = useLocation();
  const { data: config } = useLoad(api.config, []);
  const [words, setWords] = useState("");
  const [theme, setTheme] = useState("");
  const [toWild, setToWild] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [goal, setGoal] = useState<number | null>(fork ? null : 25);
  const [email, setEmail] = useState("");
  const [penName, setPenName] = useState("");
  const [showCity, setShowCity] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const validate = () => {
    setTouched(true);
    const w = checkFourWords(words);
    if (!w.ok) return w.error!;
    if (!toWild && !isEmail(recipient)) return "Who gets it first? Add their email, or release it into the wild.";
    if (!isEmail(email)) return "We need your email for your creator key.";
    if (!toWild && recipient.trim().toLowerCase() === email.trim().toLowerCase()) return "Send it to someone else. That's the whole game.";
    setError(null);
    return null;
  };

  const onPaid = async (orderId: string) => {
    try {
      const body = {
        orderId,
        creatorEmail: email,
        words,
        theme: fork ? null : theme || null,
        goal: fork ? null : goal,
        firstRecipient: toWild ? null : recipient,
        penName: penName || null,
        showCity,
      };
      const out = fork ? await api.fork(fork.serial, { ...body, atHop: fork.atHop }) : await api.mint(body);
      navigate(`/b/${out.serial}?c=${out.creatorToken}&new=1`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-7">
      <section>
        <label className="mb-2 block font-display text-xl font-semibold">
          {fork ? `Your four words, picking up after hop ${fork.atHop}` : "The foreword: your first four words"}
        </label>
        {fork && <p className="mb-3 font-display text-lg italic text-muted">“…{fork.tail}”</p>}
        <WordInput value={words} onChange={setWords} autoFocus touched={touched} placeholder={fork ? "but the robot refused" : "once a lonely robot"} />
      </section>

      {!fork && (
        <section>
          <label className="mb-2 block font-display text-xl font-semibold">
            What's it about? <span className="text-base font-normal text-muted">optional</span>
          </label>
          <input className="field" value={theme} onChange={(e) => setTheme(e.target.value)} maxLength={140} placeholder="a robot learning to dream" />
          <p className="mt-1.5 text-sm text-muted">A prompt for strangers. The bill's personality grows out of it too.</p>
        </section>
      )}

      <section>
        <label className="mb-2 block font-display text-xl font-semibold">Who gets it first?</label>
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-full border border-line bg-paper-2 p-1">
          {[false, true].map((wild) => (
            <button
              key={String(wild)}
              type="button"
              onClick={() => setToWild(wild)}
              className={`rounded-full px-3 py-2 text-sm font-semibold transition ${toWild === wild ? "bg-ink text-paper shadow" : "text-muted"}`}
            >
              {wild ? "Release to the wild" : "Send to someone"}
            </button>
          ))}
        </div>
        {toWild ? (
          <p className="text-sm text-muted">It'll appear on the Wild page. The first stranger to claim it gets the dollar and the next four words.</p>
        ) : (
          <>
            <input className="field" type="email" inputMode="email" autoComplete="off" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="friend@example.com" />
            <p className="mt-1.5 text-sm text-muted">They get $1 via PayPal plus an email from the bill. No signup needed.</p>
          </>
        )}
      </section>

      {!fork && (
        <section>
          <label className="mb-2 block font-display text-xl font-semibold">
            A goal? <span className="text-base font-normal text-muted">just for motivation</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {GOALS.map((g) => (
              <button
                key={String(g)}
                type="button"
                onClick={() => setGoal(g)}
                className={`chip !px-3.5 !py-1.5 !text-sm ${goal === g ? "!border-ink !bg-ink !text-paper" : ""}`}
              >
                {g ? `${g} hops` : "No goal"}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-sm text-muted">No limit either way. Hitting the goal invites you to write the finale.</p>
        </section>
      )}

      <section className="space-y-3">
        <label className="block font-display text-xl font-semibold">You</label>
        <input className="field" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <p className="-mt-1 text-sm text-muted">For your creator key: you write the ending. Never shown publicly.</p>
        <input className="field" value={penName} onChange={(e) => setPenName(e.target.value)} maxLength={24} placeholder="Pen name (optional)" />
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[#17402f]" checked={showCity} onChange={(e) => setShowCity(e.target.checked)} />
          <span>
            Stamp it with my city{config?.place ? <> (<b>{config.place}</b>)</> : null}. City-level only.
          </span>
        </label>
      </section>

      <section>
        {error && <div className="mb-3 rounded-xl border border-serial/30 bg-serial/5 px-3.5 py-2.5 text-sm font-medium text-serial">{error}</div>}
        <Checkout config={config} purpose={fork ? "fork" : "mint"} validate={validate} onPaid={onPaid} onError={setError} />
      </section>
    </div>
  );
}
