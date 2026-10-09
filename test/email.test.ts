import { expect, it, vi } from "vitest";
import { sendMail } from "../worker/email";
import { INFO_LINKS, SUPPORT_EMAIL } from "../shared/info";

it("keeps service mail within the provider's header contract and includes the public policies", async () => {
  const send = vi.fn(async (message: { replyTo?: string; headers?: Record<string, string>; html: string; text: string }) => {
    // Cloudflare rejects first-class API fields supplied as custom headers.
    const reserved = new Set(["from", "to", "cc", "bcc", "subject", "reply-to"]);
    if (Object.keys(message.headers ?? {}).some((key) => reserved.has(key.toLowerCase()))) throw new Error("E_HEADER_USE_API_FIELD");
    return { messageId: "test-message" };
  });
  const bind = vi.fn(() => ({ run: async () => ({ success: true }) }));
  const env = {
    EMAIL_MODE: "send", MAIL_FROM: "buck@fourwordpass.com",
    EMAIL: { send }, DB: { prepare: () => ({ bind }) },
  } as unknown as Env;
  const unsubscribeUrl = "https://fourwordpass.com/f/test-settings";
  expect(await sendMail(env, {
    to: "reader@example.com", kind: "follow", serial: "FWP-0001",
    subject: "A story update", heading: "Four more words", paragraphs: ["The story moved."], unsubscribeUrl,
  })).toBe(true);
  expect(send).toHaveBeenCalledOnce();
  const message = send.mock.calls[0][0] as { from: { name: string }; replyTo?: string; headers?: Record<string, string>; html: string; text: string };
  expect(message.from.name).toBe("Four Word Pass");
  expect(message.replyTo).toBe(SUPPORT_EMAIL);
  expect(message.headers?.["List-Unsubscribe"]).toBe(`<${unsubscribeUrl}>`);
  for (const { path } of INFO_LINKS) {
    expect(message.html).toContain(`https://fourwordpass.com${path}`);
    expect(message.text).toContain(`https://fourwordpass.com${path}`);
  }
  expect(message.text).toContain("Sandbox beta: test money, real app emails.");
  expect(bind.mock.calls[0][7]).toBeNull(); // Production delivery logs omit the private message body.
});
