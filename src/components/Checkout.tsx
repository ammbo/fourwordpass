import { useEffect, useRef, useState } from "react";
import type { AppConfig } from "../../shared/types";
import { api } from "../api";

type PayPalButtons = {
  render(el: HTMLElement): Promise<void>;
  close(): Promise<void>;
};
type PayPalNamespace = {
  Buttons(opts: {
    style?: Record<string, unknown>;
    onClick?: (data: unknown, actions: { resolve(): void; reject(): void }) => void;
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

type Props = {
  config: AppConfig | null;
  purpose: "mint" | "fork";
  /** Return an error message to block checkout, or null to proceed. */
  validate: () => string | null;
  onPaid: (orderId: string) => Promise<void>;
  onError: (msg: string) => void;
};

/** $2: one dollar rides with the bill, one keeps the lights on. Real PayPal sandbox checkout, or a simulation in mock mode. */
export function Checkout({ config, purpose, validate, onPaid, onError }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const latest = useRef({ validate, onPaid, onError });
  latest.current = { validate, onPaid, onError };
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (config?.paypalMode !== "sandbox" || !config.paypalClientId || !el.current) return;
    let buttons: PayPalButtons | null = null;
    let cancelled = false;
    loadSdk(config.paypalClientId)
      .then((paypal) => {
        if (cancelled || !el.current) return;
        buttons = paypal.Buttons({
          style: { layout: "vertical", shape: "pill", color: "black", label: "pay", height: 48 },
          onClick: (_d, actions) => {
            const err = latest.current.validate();
            if (err) {
              latest.current.onError(err);
              actions.reject();
            } else actions.resolve();
          },
          createOrder: async () => (await api.checkout(purpose)).orderId,
          onApprove: async ({ orderID }) => {
            setBusy(true);
            try {
              await latest.current.onPaid(orderID);
            } finally {
              setBusy(false);
            }
          },
          onError: () => latest.current.onError("PayPal hit a snag. Nothing was charged; try again."),
        });
        buttons.render(el.current);
      })
      .catch((e: Error) => latest.current.onError(e.message));
    return () => {
      cancelled = true;
      buttons?.close().catch(() => {});
    };
  }, [config?.paypalMode, config?.paypalClientId, purpose]);

  const simulate = async () => {
    const err = validate();
    if (err) return onError(err);
    setBusy(true);
    try {
      const { orderId } = await api.checkout(purpose);
      await onPaid(orderId);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 rounded-xl border border-line bg-paper-2/60 p-3 text-sm">
        <div className="flex justify-between"><span>$1 for the buck to carry</span><span className="font-mono">$1.00</span></div>
        <div className="flex justify-between text-muted"><span>$1 to keep the lights on</span><span className="font-mono">$1.00</span></div>
        <div className="mt-1.5 flex justify-between border-t border-line pt-1.5 font-semibold"><span>Total</span><span className="font-mono">$2.00</span></div>
      </div>
      {config?.paypalMode === "sandbox" ? (
        <>
          <div ref={el} className={busy ? "pointer-events-none opacity-50" : ""} />
          <p className="mt-2 text-center text-xs text-muted">PayPal sandbox: use a sandbox buyer account. No real money moves.</p>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-primary w-full !py-3.5" onClick={simulate} disabled={busy || !config}>
            {busy ? "Printing your buck…" : "Pay $2 (simulated)"}
          </button>
          <p className="mt-2 text-center text-xs text-muted">Demo mode: PayPal is simulated until sandbox keys are configured.</p>
        </>
      )}
      {busy && config?.paypalMode === "sandbox" && <p className="mt-2 text-center text-sm font-medium">Printing your buck…</p>}
    </div>
  );
}
