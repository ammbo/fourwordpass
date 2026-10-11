#!/usr/bin/env node
// Registers the Payouts webhook for PAYPAL_MODE=sandbox or live.
// Supply scoped credentials through the environment. Store the printed webhook id
// in the matching PAYPAL_SANDBOX_WEBHOOK_ID or PAYPAL_LIVE_WEBHOOK_ID secret.
const mode = process.env.PAYPAL_MODE ?? "sandbox";
if (mode !== "sandbox" && mode !== "live") throw new Error("PAYPAL_MODE must be sandbox or live for webhook registration.");
const base = mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const site = (process.argv[2] ?? "https://fourwordpass.com").replace(/\/$/, "");
const prefix = `PAYPAL_${mode.toUpperCase()}`;
const scoped = mode === "live" || Boolean(process.env.PAYPAL_SANDBOX_CLIENT_ID || process.env.PAYPAL_SANDBOX_CLIENT_SECRET || process.env.PAYPAL_SANDBOX_WEBHOOK_ID);
const id = process.env[`${prefix}_CLIENT_ID`] || (!scoped ? process.env.PAYPAL_CLIENT_ID : undefined);
const secret = process.env[`${prefix}_CLIENT_SECRET`] || (!scoped ? process.env.PAYPAL_CLIENT_SECRET : undefined);
if (!id || !secret) throw new Error(`Set ${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET.`);

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
  console.log(`${prefix}_WEBHOOK_ID=${existing.id}`);
  process.exit(0);
}

const res = await fetch(`${base}/v1/notifications/webhooks`, { method: "POST", headers, body: JSON.stringify({ url, event_types: events }) });
const body = await res.json();
if (!res.ok) throw new Error(`Webhook registration failed: ${JSON.stringify(body)}`);
console.log(`Registered ${url}`);
console.log(`${prefix}_WEBHOOK_ID=${body.id}`);
