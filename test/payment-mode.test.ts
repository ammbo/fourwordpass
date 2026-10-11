import { describe, expect, it, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Checkout } from "../src/components/Checkout";
import { infoPagesForMode, infoLinksForMode, infoHtml } from "../shared/info";
import { faqForMode, pageMeta, renderHead } from "../shared/site";
import { paypalCredentials, paypalMode, getPayout, verifyWebhook } from "../worker/paypal";
import worker from "../worker/index";

const credentials = {
  PAYPAL_CLIENT_ID: "legacy-client", PAYPAL_CLIENT_SECRET: "legacy-secret", PAYPAL_WEBHOOK_ID: "legacy-hook",
  PAYPAL_SANDBOX_CLIENT_ID: "test-client", PAYPAL_SANDBOX_CLIENT_SECRET: "test-secret", PAYPAL_SANDBOX_WEBHOOK_ID: "test-hook",
  PAYPAL_LIVE_CLIENT_ID: "real-client", PAYPAL_LIVE_CLIENT_SECRET: "real-secret", PAYPAL_LIVE_WEBHOOK_ID: "real-hook",
};
afterEach(() => vi.unstubAllGlobals());

describe("one payment environment switch", () => {
  it("selects matching public and private credentials without exposing secrets", async () => {
    for (const mode of ["sandbox", "live", "mock"] as const) {
      const env = {...credentials, PAYPAL_MODE: mode} as Env;
      expect(paypalMode(env)).toBe(mode);
      const response = await worker.fetch(new Request("https://fourwordpass.com/api/config"), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({paypalMode: mode, paypalClientId: mode === "mock" ? null : mode === "live" ? "real-client" : "test-client"});
      expect(paypalCredentials(env).clientSecret).toBe(mode === "live" ? "real-secret" : "test-secret");
    }
  });
  it("never falls back to generic sandbox credentials in live or mixes partial scoped sets", () => {
    expect(() => paypalMode({PAYPAL_MODE: "live", PAYPAL_CLIENT_ID: "legacy", PAYPAL_CLIENT_SECRET: "legacy"} as Env)).toThrow("credentials");
    expect(() => paypalMode({PAYPAL_MODE: "sandbox", PAYPAL_SANDBOX_CLIENT_ID: "partial", PAYPAL_CLIENT_ID: "legacy", PAYPAL_CLIENT_SECRET: "legacy"} as Env)).toThrow("credentials");
  });
  it("uses the selected API host and credentials for reconciliation and webhook verification", async () => {
    for (const mode of ["live", "sandbox"] as const) {
      const fetch = vi.fn().mockResolvedValueOnce(Response.json({access_token: "token", expires_in: 3600}))
        .mockResolvedValueOnce(Response.json({batch_header: {batch_status: "SUCCESS"}, items: []}))
        .mockResolvedValueOnce(Response.json({verification_status: "SUCCESS"}));
      vi.stubGlobal("fetch", fetch);
      const env = {...credentials, PAYPAL_MODE: mode} as Env;
      await getPayout(env, "batch");
      await verifyWebhook(env, new Headers(), '{"id":"event"}');
      expect(fetch.mock.calls[0][0]).toBe(`https://api-m.${mode === "sandbox" ? "sandbox." : ""}paypal.com/v1/oauth2/token`);
      expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Basic ${btoa(mode === "live" ? "real-client:real-secret" : "test-client:test-secret")}`);
      expect(fetch.mock.calls[2][1].body).toContain(`"webhook_id":"${mode === "live" ? "real-hook" : "test-hook"}"`);
    }
  });
  it("shows the test card only in sandbox and keeps simulation and live pause explicit", () => {
    for (const mode of ["sandbox", "live", "mock"] as const) {
      const html = renderToStaticMarkup(createElement(Checkout, {
        config: {paypalMode: mode, paypalClientId: "client"}, purpose: "mint", recoveryKey: "recovery",
        validate: () => null, onPaid: async () => {}, onError: () => {},
      }));
      expect(html.includes("4012 0000 7777 7777")).toBe(mode === "sandbox");
      expect(html.toLowerCase().includes("sandbox")).toBe(mode === "sandbox");
      if (mode === "live") expect(html).toContain("paused");
      if (mode === "mock") expect(html).toContain("simulated");
    }
  });
  it("keeps every policy page, metadata, footer and FAQ consistent with the selected mode", () => {
    for (const mode of ["live", "mock", null] as const) {
      for (const page of Object.values(infoPagesForMode(mode))) {
        expect(infoHtml(page).toLowerCase()).not.toContain("sandbox");
        expect(renderHead(pageMeta(page.path, mode), mode).toLowerCase()).not.toContain("sandbox");
      }
      expect(JSON.stringify(infoLinksForMode(mode))).not.toContain("Sandbox");
      expect(JSON.stringify(faqForMode(mode))).not.toContain("sandbox");
    }
    expect(infoHtml(infoPagesForMode("sandbox")["/terms"])).toContain("sandbox test card");
  });
});
