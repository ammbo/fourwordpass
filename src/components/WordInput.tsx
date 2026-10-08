import { forwardRef } from "react";
import { CONTENT_WORDS, FINALE_MAX_CONTENT, checkFinale, checkFourWords } from "../../shared/words";

type Props = {
  value: string;
  onChange: (v: string) => void;
  mode?: "four" | "finale";
  placeholder?: string;
  autoFocus?: boolean;
  touched?: boolean;
};

/** The heart of the product: a live content-word counter that teaches the rule as you type. */
export const WordInput = forwardRef<HTMLInputElement, Props>(function WordInput(
  { value, onChange, mode = "four", placeholder, autoFocus, touched },
  ref,
) {
  const check = mode === "four" ? checkFourWords(value) : checkFinale(value);
  const target = mode === "four" ? CONTENT_WORDS : FINALE_MAX_CONTENT;
  const over = check.content > target;
  const showError = !check.ok && (touched || check.raw >= (mode === "four" ? 4 : 1));

  return (
    <div>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? (mode === "four" ? "the robot learned to dream" : "and that was the last of it")}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck
        enterKeyHint="next"
        maxLength={mode === "four" ? 90 : 200}
        className="field font-display !text-[1.35rem] !py-3.5"
        aria-describedby="word-meter"
      />
      <div className="mt-2.5 flex min-h-[26px] flex-wrap items-center gap-1.5" aria-hidden>
        {check.tokens.map((t, i) => (
          <span
            key={i}
            className={`animate-rise rounded-md px-1.5 py-0.5 text-[0.8rem] font-medium ${
              t.content ? "bg-ink text-paper" : "border border-dashed border-line text-muted"
            }`}
            title={t.content ? "counts" : "free word"}
          >
            {t.raw}
            {!t.content && <sup className="ml-0.5 font-mono text-[0.55rem] uppercase">free</sup>}
          </span>
        ))}
      </div>
      <div id="word-meter" className="mt-2 flex items-center gap-3" aria-live="polite">
        {mode === "four" ? (
          <div className="flex gap-1.5">
            {Array.from({ length: CONTENT_WORDS }).map((_, i) => (
              <span
                key={i}
                className={`h-3 w-7 rounded-full border transition-colors ${
                  over ? "border-serial bg-serial" : i < check.content ? "border-ink bg-ink" : "border-line bg-paper-3"
                }`}
              />
            ))}
          </div>
        ) : (
          <span className={`font-mono text-sm ${over ? "text-serial" : "text-ink"}`}>
            {check.content}/{target}
          </span>
        )}
        <span className={`text-sm ${showError ? "text-serial" : check.ok ? "font-semibold text-ink" : "text-muted"}`}>
          {check.ok
            ? mode === "four"
              ? "Four. The buck approves."
              : "Ready to end it."
            : showError
              ? check.error
              : mode === "four"
                ? `${check.content} of 4 content words · the, a, to, and… are free`
                : "Up to 12 words that count"}
        </span>
      </div>
    </div>
  );
});
