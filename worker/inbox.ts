// Inbound email: Email Routing sends every message for @fourwordpass.com here.
// Stored in D1 and readable via /api/admin/inbox, so tests (and agents) can
// follow the real links the bill emails out.

import PostalMime from "postal-mime";
import { newId, now } from "./util";

const MAX_BYTES = 512 * 1024;

export async function receiveEmail(message: ForwardableEmailMessage, env: Env) {
  if (message.rawSize > MAX_BYTES) {
    message.setReject("Message too large");
    return;
  }
  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw);
  const text = (parsed.text ?? "").slice(0, 50_000);
  const html = (parsed.html ?? "").slice(0, 100_000);
  const links = [...new Set([...(text + " " + html).matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0].replace(/&amp;/g, "&")))];
  await env.DB.prepare("INSERT INTO inbox (id, to_email, from_email, subject, text, html, links, received_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(newId(), message.to.toLowerCase(), message.from.toLowerCase(), parsed.subject ?? null, text, html, JSON.stringify(links), now())
    .run();
}
