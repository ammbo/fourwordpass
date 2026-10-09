// PayPal: Payouts (money out, every hop) and Orders (money in, $2 mint/fork).
// The platform is the sender of record on every payout, so we observe every hop
// directly — no scraping, no third-party feeds.
//
// PAYPAL_MODE picks the environment: live (real money), sandbox (test money), or mock.
// Mock simulates both APIs so the whole loop runs without credentials.
// Mock payouts settle ~3s after creation; any recipient containing "+fail" fails.

import { HOP_AMOUNT, MINT_PRICE } from "../shared/brand";
import type { PayPalMode } from "../shared/types";

const API_BASE = { live: "https://api-m.paypal.com", sandbox: "https://api-m.sandbox.paypal.com" };

export type PayoutState = {
  status: string;               // PENDING | SUCCESS | UNCLAIMED | FAILED | ...
  itemId: string | null;
  transactionId: string | null;
  error: string | null;
};

/**
 * UNCLAIMED counts as delivered: it means PayPal accepted the money for someone
 * who doesn't have a PayPal account yet. That's every real email in sandbox and
 * many people in production. Gating on SUCCESS alone would stall most chains.
 */
export const DELIVERED = new Set(["SUCCESS", "UNCLAIMED"]);
export const FAILED = new Set(["FAILED", "BLOCKED", "DENIED", "RETURNED", "REFUNDED", "REVERSED", "CANCELED"]);

export function paypalMode(env: Env): PayPalMode {
  if (env.PAYPAL_MODE === "mock") return "mock";
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return "mock";
  return env.PAYPAL_MODE === "live" ? "live" : "sandbox";
}

const apiBase = (env: Env) => API_BASE[paypalMode(env) === "live" ? "live" : "sandbox"];

let cachedToken: { value: string; expires: number; clientId: string } | null = null;

async function accessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.clientId === env.PAYPAL_CLIENT_ID && cachedToken.expires > Date.now()) {
    return cachedToken.value;
  }
  const res = await fetch(`${apiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expires: Date.now() + (data.expires_in - 120) * 1000, clientId: env.PAYPAL_CLIENT_ID };
  return data.access_token;
}

async function api<T>(env: Env, path: string, init: { method?: string; body?: unknown; rawBody?: string; idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken(env)}`,
    "Content-Type": "application/json",
  };
  if (init.idempotencyKey) headers["PayPal-Request-Id"] = init.idempotencyKey;
  const res = await fetch(`${apiBase(env)}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { message?: string; name?: string; details?: { issue?: string; description?: string }[] };
      message = j.details?.[0]?.description || j.details?.[0]?.issue || j.message || j.name || message;
    } catch { /* keep raw text */ }
    throw new PayPalError(res.status, message);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export class PayPalError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- Payouts

export async function createPayout(
  env: Env,
  p: { passId: string; email: string; note: string; subject: string; message: string },
): Promise<{ batchId: string }> {
  if (paypalMode(env) === "mock") {
    return { batchId: `MOCK${Date.now().toString(36).toUpperCase()}${p.email.includes("+fail") ? "F" : "S"}` };
  }
  const res = await api<{ batch_header: { payout_batch_id: string } }>(env, "/v1/payments/payouts", {
    method: "POST",
    idempotencyKey: p.passId,
    body: {
      sender_batch_header: {
        sender_batch_id: p.passId,          // PayPal rejects duplicate batch ids: free idempotency
        email_subject: p.subject,
        email_message: p.message,
        recipient_type: "EMAIL",
      },
      items: [
        {
          recipient_type: "EMAIL",
          amount: { value: HOP_AMOUNT, currency: "USD" },
          receiver: p.email,
          note: p.note,
          sender_item_id: p.passId,
          notification_language: "en-US",
        },
      ],
    },
  });
  return { batchId: res.batch_header.payout_batch_id };
}

export async function getPayout(env: Env, batchId: string): Promise<PayoutState> {
  if (batchId.startsWith("MOCK")) {
    const created = parseInt(batchId.slice(4, -1), 36);
    const willFail = batchId.endsWith("F");
    if (Date.now() - created < 2500) return { status: "PENDING", itemId: null, transactionId: null, error: null };
    return {
      status: willFail ? "FAILED" : "UNCLAIMED",
      itemId: `MOCKITEM${batchId.slice(4)}`,
      transactionId: willFail ? null : `MOCKTXN${batchId.slice(4)}`,
      error: willFail ? "RECEIVER_UNREGISTERED (simulated)" : null,
    };
  }
  const res = await api<{
    items?: {
      payout_item_id: string;
      transaction_id?: string;
      transaction_status?: string;
      errors?: { name?: string; message?: string };
    }[];
    batch_header: { batch_status: string };
  }>(env, `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
  const item = res.items?.[0];
  return {
    status: item?.transaction_status ?? res.batch_header.batch_status ?? "PENDING",
    itemId: item?.payout_item_id ?? null,
    transactionId: item?.transaction_id ?? null,
    error: item?.errors ? `${item.errors.name ?? ""} ${item.errors.message ?? ""}`.trim() : null,
  };
}

// ---------------------------------------------------------------- Orders (the $2 mint)

export async function createOrder(env: Env, purpose: "mint" | "fork"): Promise<string> {
  if (paypalMode(env) === "mock") return `MOCKORDER-${crypto.randomUUID()}`;
  const usd = (value: string) => ({ currency_code: "USD", value });
  const res = await api<{ id: string }>(env, "/v2/checkout/orders", {
    method: "POST",
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          description: purpose === "mint" ? "Release a buck" : "Fork a story",
          amount: { ...usd(MINT_PRICE), breakdown: { item_total: usd(MINT_PRICE) } },
          items: [
            { name: "$1 for the buck to carry", quantity: "1", unit_amount: usd("1.00"), category: "DIGITAL_GOODS" },
            { name: "$1 to keep the lights on", quantity: "1", unit_amount: usd("1.00"), category: "DIGITAL_GOODS" },
          ],
        },
      ],
      payment_source: {
        paypal: { experience_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", brand_name: "Four Word Pass" } },
      },
    },
  });
  return res.id;
}

/** Capture and verify the $2. Returns the capture id. Throws if anything is off. */
export async function captureOrder(env: Env, orderId: string): Promise<string> {
  if (orderId.startsWith("MOCKORDER-")) {
    if (paypalMode(env) !== "mock") throw new Error("Simulated checkout is off.");
    return orderId;
  }
  const res = await api<{
    status: string;
    purchase_units: { payments?: { captures?: { id: string; status: string; amount: { value: string; currency_code: string } }[] } }[];
  }>(env, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST", idempotencyKey: `cap-${orderId}` });
  const cap = res.purchase_units?.[0]?.payments?.captures?.[0];
  if (res.status !== "COMPLETED" || !cap || cap.status !== "COMPLETED") throw new Error("Payment didn't complete.");
  if (cap.amount.value !== MINT_PRICE || cap.amount.currency_code !== "USD") throw new Error("Unexpected payment amount.");
  return cap.id;
}

// ---------------------------------------------------------------- Webhooks

/**
 * Verify via PayPal's verify-webhook-signature API. The event must be embedded
 * byte-for-byte: re-serialising the parsed JSON can change it and break the check.
 */
export async function verifyWebhook(env: Env, headers: Headers, rawBody: string): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID || paypalMode(env) === "mock") return false;
  const h = (k: string) => JSON.stringify(headers.get(k) ?? "");
  const body =
    `{"auth_algo":${h("paypal-auth-algo")},"cert_url":${h("paypal-cert-url")},` +
    `"transmission_id":${h("paypal-transmission-id")},"transmission_sig":${h("paypal-transmission-sig")},` +
    `"transmission_time":${h("paypal-transmission-time")},"webhook_id":${JSON.stringify(env.PAYPAL_WEBHOOK_ID)},` +
    `"webhook_event":${rawBody}}`;
  try {
    const res = await api<{ verification_status: string }>(env, "/v1/notifications/verify-webhook-signature", {
      method: "POST",
      rawBody: body,
    });
    return res.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

const EVENT_STATUS: Record<string, string> = {
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "SUCCESS",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.FAILED": "FAILED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": "BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.DENIED": "DENIED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED": "RETURNED",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED": "REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED": "CANCELED",
  "PAYMENT.PAYOUTS-ITEM.HELD": "ONHOLD",
};

export function parsePayoutEvent(event: {
  event_type?: string;
  resource?: {
    payout_item_id?: string;
    transaction_id?: string;
    transaction_status?: string;
    payout_item?: { sender_item_id?: string };
    errors?: { name?: string; message?: string };
  };
}): { passId: string | null; state: PayoutState } | null {
  const status = event.event_type ? EVENT_STATUS[event.event_type] : undefined;
  if (!status || !event.resource) return null;
  const r = event.resource;
  return {
    passId: r.payout_item?.sender_item_id ?? null,
    state: {
      status: r.transaction_status ?? status,
      itemId: r.payout_item_id ?? null,
      transactionId: r.transaction_id ?? null,
      error: r.errors ? `${r.errors.name ?? ""} ${r.errors.message ?? ""}`.trim() : null,
    },
  };
}
