import { LIVE_PAYMENT_NOTICE } from "../../shared/payments";
import { useEffect, useRef, useState } from "react";
import type { AppConfig } from "../../shared/types";
import { api } from "../api";

type PayPalButtons = {
  render(el: HTMLElement): Promise<void>;
  close(): Promise<void>;
};
type PayPalNamespace = {
  FUNDING: { CARD: string };
  Buttons(opts: {
    fundingSource?: string;
    style?: Record<string, unknown>;
    onClick?: (data: unknown, actions: { resolve(): Promise<void>; reject(): Promise<void> }) => Promise<void> | void;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onError?: (err: unknown) => void;
    onCancel?: () => void;
  }): PayPalButtons;
};

let sdk: Promise<PayPalNamespace> | null = null;
function loadSdk(clientId: string): Promise<PayPalNamespace> {
  sdk ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons&disable-funding=paylater,venmo,credit`;
    s.onload = () => resolve((window as unknown as { paypal: PayPalNamespace }).paypal);
    s.onerror = () => {
      sdk = null;
      reject(new Error("PayPal didn't load. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return sdk;
}

// One of PayPal's published sandbox Visa numbers. Most visitors have no sandbox login, so everyone sees it.
// PayPal's card form also requires a ZIP and a mobile number; fictional ones keep real details out of a test.
const TEST_CARD = [
  ["Card", "4012 0000 7777 7777", "4012000077777777"],
  ["Expires", "12/30", "1230"],
  ["CSC", "123", "123"],
  ["ZIP", "95131", "95131"],
  ["Mobile", "408 555 0100", "4085550100"],
] as const;

type Props = {
  recoveryKey: string;
  config: AppConfig | null;
  purpose: "mint" | "fork";
  /** Return an error message to block checkout, or null to proceed. May check with the server first. */
  validate: () => string | null | Promise<string | null>;
  onPaid: (orderId: string) => Promise<void>;
  onError: (msg: string) => void;
};

/** $2: one dollar rides with the bill, one keeps the lights on. Real PayPal sandbox checkout, or a simulation in mock mode. */
export function Checkout({ recoveryKey, config, purpose, validate, onPaid, onError }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const latest = useRef({ validate, onPaid, onError });
  latest.current = { validate, onPaid, onError };
  const [busy, setBusy] = useState(false);
  const sandbox = config?.paypalMode === "sandbox";
  const real = sandbox;

  useEffect(() => {
    if (!real || !config.paypalClientId || !el.current) return;
    let buttons: PayPalButtons | null = null;
    let cancelled = false;
    loadSdk(config.paypalClientId)
      .then((paypal) => {
        if (cancelled || !el.current) return;
        buttons = paypal.Buttons({
          // Sandbox shows the card button only. Visitors would otherwise try their real PayPal login,
          // which can't work in the sandbox, and on phones the PayPal app hijacks the sandbox login.
          ...(sandbox && { fundingSource: paypal.FUNDING.CARD }),
          style: { layout: "vertical", shape: "pill", color: "black", label: "pay", height: 48 },
          onClick: async (_d, actions) => {
            const err = await latest.current.validate();
            if (err) {
              latest.current.onError(err);
              return actions.reject();
            }
            return actions.resolve();
          },
          createOrder: async () => (await api.checkout(purpose,recoveryKey)).orderId,
          onApprove: async ({ orderID }) => {
            setBusy(true);
            try {
              await latest.current.onPaid(orderID);
            } finally {
              setBusy(false);
            }
          },
          onError: () => latest.current.onError("PayPal hit a snag. Check the saved checkout below before starting another payment."),
        });
        return buttons.render(el.current);
      })
      .catch((e: Error) => latest.current.onError(e.message));
    return () => {
      cancelled = true;
      buttons?.close().catch(() => {});
    };
  }, [config?.paypalMode, config?.paypalClientId, purpose, recoveryKey]);

  const simulate = async () => {
    const err = await validate();
    if (err) return onError(err);
    setBusy(true);
    try {
      const { orderId } = await api.checkout(purpose,recoveryKey);
      await onPaid(orderId);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (config?.paypalMode === "live") return <p role="status" className="rounded-xl border border-line p-4 text-sm">{LIVE_PAYMENT_NOTICE}</p>;
  return (
    <div>
      <div className="mb-3 rounded-xl border border-line bg-paper-2/60 p-3 text-sm">
        <div className="flex justify-between"><span>$1 for the buck to carry</span><span className="font-mono">$1.00</span></div>
        <div className="flex justify-between text-muted"><span>$1 to keep the lights on</span><span className="font-mono">$1.00</span></div>
        <div className="mt-1.5 flex justify-between border-t border-line pt-1.5 font-semibold"><span>Total</span><span className="font-mono">$2.00</span></div>
      </div>
      {real ? (
        <>
          {sandbox && <TestCard />}
          <div ref={el} className={busy ? "pointer-events-none opacity-50" : ""} />
          {sandbox && <p className="mt-2 text-center text-xs text-muted">PayPal sandbox. No real money moves.</p>}
        </>
      ) : (
        <>
          <button type="button" className="btn btn-primary w-full !py-3.5" onClick={simulate} disabled={busy || !config}>
            {busy ? "Printing your buck…" : !config ? "Loading checkout…" : "Pay $2 (simulated)"}
          </button>
          <p className="mt-2 text-center text-xs text-muted">Demo mode: checkout and payouts are simulated. No real money moves.</p>
        </>
      )}
      {busy && real && <p className="mt-2 text-center text-sm font-medium">Printing your buck…</p>}
    </div>
  );
}

/** Placed above the buttons: PayPal's card form opens inline below them and would push this out of view. */
function TestCard() {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="mb-3 rounded-xl border border-dashed border-line p-3 text-sm">
      <div className="font-semibold">Pay with PayPal's sandbox test card</div>
      <p className="mt-0.5 text-xs text-muted">Choose Debit or Credit Card and enter these, with any name and email.</p>
      <p className="mt-1.5 text-xs font-semibold text-serial">Test money only. Don't enter your own card: real cards don't work here.</p>
      <dl className="mt-2 space-y-1">
        {TEST_CARD.map(([label, shown, value]) => (
          <div key={label} className="flex items-center gap-3">
            <dt className="w-14 text-xs text-muted">{label}</dt>
            <dd className="flex-1 font-mono">{shown}</dd>
            <button
              type="button"
              className="text-xs font-semibold text-ink underline-offset-4 hover:underline"
              onClick={() => navigator.clipboard?.writeText(value).then(() => setCopied(label), () => {})}
            >
              {copied === label ? "Copied" : "Copy"}
            </button>
          </div>
        ))}
      </dl>
    </div>
  );
}
