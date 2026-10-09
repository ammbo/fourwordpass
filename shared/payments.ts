import type { PayPalMode } from "./types";

// Live collection stays closed until the held-dollar settlement rule is implemented.
export const LIVE_PAYMENT_NOTICE = "Live payments are paused while the final payout model is being completed.";
export function paymentNotice(mode?: PayPalMode | null) {
  if (mode === "live") return LIVE_PAYMENT_NOTICE;
  if (mode === "mock") return "Demo mode: checkout and payouts are simulated. No real money changes hands.";
  if (mode === "sandbox") return "Sandbox beta: checkout and payouts use PayPal test money. No real money changes hands.";
  return "Payment configuration is temporarily unavailable.";
}
export function payoutDescription(mode?: PayPalMode | null) {
  return mode === "sandbox" ? "We send a $1 PayPal sandbox test payout."
    : mode === "mock" ? "The $1 handoff is simulated."
    : mode === "live" ? LIVE_PAYMENT_NOTICE : "Payments are temporarily unavailable.";
}
