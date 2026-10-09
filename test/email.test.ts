import { expect, it, vi } from "vitest";
import { DB } from "./helpers/db";
import { sendMail, retryMail } from "../worker/email";
import { INFO_LINKS, SUPPORT_EMAIL } from "../shared/info";

it("keeps service mail within the provider's header contract and includes the public policies", async () => {
  const send = vi.fn(async (message: { replyTo?: string; headers?: Record<string, string>; html: string; text: string }) => {
    // Cloudflare rejects first-class API fields supplied as custom headers.
    const reserved = new Set(["from", "to", "cc", "bcc", "subject", "reply-to"]);
    if (Object.keys(message.headers ?? {}).some((key) => reserved.has(key.toLowerCase()))) throw new Error("E_HEADER_USE_API_FIELD");
    return { messageId: "test-message" };
  });
  const db = new DB();
  const env = {PAYPAL_MODE: "sandbox", EMAIL_MODE: "send", MAIL_FROM: "buck@fourwordpass.com", EMAIL: {send}, DB: db} as unknown as Env;
  const unsubscribeUrl = "https://fourwordpass.com/f/test-settings";
  expect(await sendMail(env, {
    to: "reader@example.com", kind: "follow", serial: "FWP-0001",
    subject: "A story update", heading: "Four more words", paragraphs: ["The story moved."], unsubscribeUrl,
  })).toBe(true);
  expect(send).toHaveBeenCalledOnce();
  const message = send.mock.calls[0][0] as { from: { name: string }; replyTo?: string; headers?: Record<string, string>; html: string; text: string };
  expect(message.from.name).toBe("Four Word Pass");
  expect(message.replyTo).toBe(SUPPORT_EMAIL);
  expect(message.headers?.["List-Unsubscribe"]).toBe("<https://fourwordpass.com/api/follows/test-settings/unsubscribe>");
  expect(message.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  for (const { path } of INFO_LINKS) {
    expect(message.html).toContain(`https://fourwordpass.com${path}`);
    expect(message.text).toContain(`https://fourwordpass.com${path}`);
  }
  expect(message.text).toContain("Sandbox beta: test money, real app emails.");
  expect(db.sqlite.prepare("SELECT body_text FROM emails").get()?.body_text).toBeNull(); // Production delivery logs omit the private message body.
});

it("renders a quieter second choice under the button", async () => {
  const send = vi.fn(async (_m: { html: string; text: string }) => ({ messageId: "m" }));
  const env = {PAYPAL_MODE: "sandbox", EMAIL_MODE: "send", MAIL_FROM: "buck@fourwordpass.com", EMAIL: {send}, DB: new DB()} as unknown as Env;
  await sendMail(env, {
    to: "holder@example.com", kind: "holder", serial: "FWP-0001", subject: "Someone passed you a story", heading: "You've been passed the buck.",
    paragraphs: ["Add four words."],
    button: { label: "Add your 4 words", url: "https://fourwordpass.com/b/FWP-0001?t=abc" },
    secondary: { label: "Not for you? Send me back", url: "https://fourwordpass.com/b/FWP-0001?t=abc&decline=1" },
  });
  const message = send.mock.calls[0][0];
  expect(message.html).toContain('href="https://fourwordpass.com/b/FWP-0001?t=abc&amp;decline=1"');
  expect(message.html).toContain("Not for you? Send me back");
  expect(message.text).toContain("Not for you? Send me back: https://fourwordpass.com/b/FWP-0001?t=abc&decline=1");
});

it("durably retries provider failure and deduplicates successful mail", async () => {
  const db = new DB();
  const send = vi.fn().mockRejectedValueOnce(new Error("Provider unavailable")).mockResolvedValue({messageId: "retry"});
  const env = {PAYPAL_MODE: "mock", EMAIL_MODE: "send", MAIL_FROM: "buck@example.com", EMAIL: {send}, DB: db} as unknown as Env;
  const mail = {deliveryKey: "unique-holder", to: "reader@example.com", kind: "holder", subject: "Your link", heading: "Hello", paragraphs: ["A story."]};
  expect(await sendMail(env, mail)).toBe(false);
  expect(db.sqlite.prepare("SELECT status FROM mail_outbox").get()?.status).toBe("pending");
  db.sqlite.exec("UPDATE mail_outbox SET next_attempt_at=0");
  await retryMail(env);
  expect(db.sqlite.prepare("SELECT status FROM mail_outbox").get()?.status).toBe("sent");
  expect(await sendMail(env, mail)).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0].text).toContain("Simulated payments");
});
