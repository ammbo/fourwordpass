// Every email comes from "Four Word Pass", so a first-time recipient knows who's writing.
// The body is in the bill's voice, with its serial printed at the top.
// EMAIL_MODE=log stores the full email in D1 instead of sending (local dev).

import { newId, now } from "./util";
import { INFO_LINKS, SUPPORT_EMAIL } from "../shared/info";
import { SHARE_IMAGE, SITE_NAME, SITE_URL } from "../shared/site";

export type Mail = {
  to: string;
  kind: string;
  billId?: string;
  serial?: string;           // printed above the heading
  subject: string;
  preheader?: string;        // inbox preview text; defaults to the first paragraph
  heading: string;
  image?: "share-card";      // the site's explainer card, for people meeting us for the first time
  paragraphs: string[];
  quote?: string;            // a slice of the story
  quoteLabel?: string;
  button?: { label: string; url: string };
  secondary?: { label: string; url: string };   // a quieter second choice under the button
  footer?: string;
  unsubscribeUrl?: string;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderHtml(m: Mail): string {
  const p = m.paragraphs
    .map((t) => `<p style="margin:0 0 14px;font:16px/1.55 Georgia,'Times New Roman',serif;color:#1d2a22">${esc(t)}</p>`)
    .join("");
  const quote = m.quote
    ? `<div style="margin:18px 0;padding:14px 16px;border-left:3px solid #17402f;background:#f3efe4">
        ${m.quoteLabel ? `<div style="font:600 11px/1.4 'Courier New',monospace;letter-spacing:.12em;text-transform:uppercase;color:#5d6f63;margin-bottom:6px">${esc(m.quoteLabel)}</div>` : ""}
        <div style="font:italic 17px/1.5 Georgia,serif;color:#17402f">${esc(m.quote)}</div></div>`
    : "";
  const button = m.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px"><tr><td style="background:#17402f;border-radius:999px">
        <a href="${esc(m.button.url)}" style="display:inline-block;padding:14px 26px;font:600 16px/1 Helvetica,Arial,sans-serif;color:#f6f1e3;text-decoration:none">${esc(m.button.label)}</a>
       </td></tr></table>
       <div style="font:12px/1.5 Helvetica,Arial,sans-serif;color:#7a857d;word-break:break-all">${esc(m.button.url)}</div>`
    : "";
  const secondary = m.secondary
    ? `<p style="margin:14px 0 0;font:14px/1.5 Helvetica,Arial,sans-serif"><a href="${esc(m.secondary.url)}" style="color:#17402f">${esc(m.secondary.label)}</a></p>`
    : "";
  const preheader = m.preheader ?? m.paragraphs[0] ?? "";
  const image = m.image
    ? `<a href="${SITE_URL}" style="display:block;margin:0 0 20px"><img src="${SHARE_IMAGE}" width="496" alt="One dollar. Many strangers. One story. Add four words. Pass it on." style="display:block;width:100%;max-width:496px;height:auto;border:0;border-radius:8px"></a>`
    : "";
  const unsub = m.unsubscribeUrl
    ? ` · <a href="${esc(m.unsubscribeUrl)}" style="color:#7a857d">Change or stop these emails</a>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#e9e4d6">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
${m.image ? "" : `<a href="${SITE_URL}" style="display:block;max-width:560px;margin:0 auto 14px"><img src="${SITE_URL}/wordmark.png" width="200" height="40" alt="${SITE_NAME}" style="display:block;border:0"></a>`}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fbf8f0;border:1px solid #c9c2ad;border-radius:14px">
<tr><td style="padding:6px"><div style="border:2px solid #17402f;border-radius:10px;padding:26px 24px">
${image}${m.serial ? `<div style="font:700 13px/1 'Courier New',monospace;letter-spacing:.18em;color:#b3261e">${esc(m.serial)}</div>` : ""}
<h1 style="margin:14px 0 16px;font:700 26px/1.2 Georgia,serif;color:#17402f">${esc(m.heading)}</h1>
${p}${quote}${button}${secondary}
${m.footer ? `<p style="margin:20px 0 0;font:13px/1.5 Helvetica,Arial,sans-serif;color:#5d6f63">${esc(m.footer)}</p>` : ""}
</div></td></tr></table>
<div style="max-width:560px;margin:14px auto 0;font:12px/1.5 Helvetica,Arial,sans-serif;color:#7a857d">Four Word Pass · a dollar, a story, four words at a time${unsub}<br>Sandbox beta: test money, real app emails.<br>${INFO_LINKS.map(({ path, label }) => `<a href="${SITE_URL}${path}" style="color:#7a857d">${label}</a>`).join(" · ")}</div>
</td></tr></table></body></html>`;
}

function renderText(m: Mail): string {
  return [
    m.heading,
    "",
    ...m.paragraphs.flatMap((p) => [p, ""]),
    m.quote ? `${m.quoteLabel ? `${m.quoteLabel}: ` : ""}"${m.quote}"\n` : "",
    m.button ? `${m.button.label}: ${m.button.url}\n` : "",
    m.secondary ? `${m.secondary.label}: ${m.secondary.url}\n` : "",
    m.footer ?? "",
    m.unsubscribeUrl ? `\nChange or stop these emails: ${m.unsubscribeUrl}` : "",
    "\n— Four Word Pass",
    "Sandbox beta: test money, real app emails.",
    ...INFO_LINKS.map(({ path, label }) => `${label}: ${SITE_URL}${path}`),
  ].join("\n");
}

export async function sendMail(env: Env, m: Mail): Promise<boolean> {
  const id = newId();
  const text = renderText(m);
  const log = (status: string, extra: { messageId?: string; error?: string; body?: string } = {}) =>
    env.DB.prepare(
      "INSERT INTO emails (id, to_email, kind, subject, bill_id, status, message_id, body_text, error, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(id, m.to, m.kind, m.subject, m.billId ?? null, status, extra.messageId ?? null, extra.body ?? null, extra.error ?? null, now())
      .run();

  if (env.EMAIL_MODE === "log") {
    console.log(`\n✉️  [${m.kind}] to ${m.to}: ${m.subject}\n${text}\n`);
    await log("logged", { body: text });
    return true;
  }
  try {
    const res = await env.EMAIL.send({
      from: { email: env.MAIL_FROM, name: SITE_NAME },
      to: m.to,
      subject: m.subject,
      html: renderHtml(m),
      text,
      replyTo: SUPPORT_EMAIL,
      ...(m.unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${m.unsubscribeUrl}>` } } : {}),
    });
    await log("sent", { messageId: res.messageId });
    return true;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error("email failed", err.code, err.message);
    await log("failed", { error: `${err.code ?? ""} ${err.message ?? ""}`.trim() });
    return false;
  }
}
