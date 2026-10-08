#!/usr/bin/env node
// Registers the Payouts webhook with PayPal sandbox and prints its id.
//
//   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... node scripts/paypal-webhook.mjs [https://fourwordpass.com]
//
// Then: npx wrangler secret put PAYPAL_WEBHOOK_ID   (paste the printed id)

const base = "https://api-m.sandbox.paypal.com";
const site = (process.argv[2] ?? "https://fourwordpass.com").replace(/\/$/, "");
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox app credentials).");
  process.exit(1);
}

const auth = await fetch(`${base}/v1/oauth2/token`, {
  method: "POST",
  headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
if (!auth.ok) throw new Error(`PayPal auth failed: ${auth.status} ${await auth.text()}`);
const { access_token } = await auth.json();
const headers = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };

const url = `${site}/api/webhooks/paypal`;
const events = ["SUCCEEDED", "UNCLAIMED", "FAILED", "BLOCKED", "DENIED", "RETURNED", "REFUNDED", "CANCELED", "HELD"].map((e) => ({
  name: `PAYMENT.PAYOUTS-ITEM.${e}`,
}));

const list = await (await fetch(`${base}/v1/notifications/webhooks`, { headers })).json();
const existing = list.webhooks?.find((w) => w.url === url);
if (existing) {
  console.log(`Webhook already registered for ${url}`);
  console.log(`PAYPAL_WEBHOOK_ID=${existing.id}`);
  process.exit(0);
}

const res = await fetch(`${base}/v1/notifications/webhooks`, { method: "POST", headers, body: JSON.stringify({ url, event_types: events }) });
const body = await res.json();
if (!res.ok) throw new Error(`Webhook registration failed: ${JSON.stringify(body)}`);
console.log(`Registered ${url}`);
console.log(`PAYPAL_WEBHOOK_ID=${body.id}`);
