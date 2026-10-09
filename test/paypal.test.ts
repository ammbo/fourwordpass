import { describe, expect, it } from "vitest";
import { PayPalError, isDuplicateBatch, isTransient } from "../worker/paypal";

describe("payout errors", () => {
  it("retries PayPal's own trouble instead of blaming the recipient", () => {
    expect(isTransient(new PayPalError(500, "Internal service error"))).toBe(true);
    expect(isTransient(new PayPalError(503, "Service unavailable"))).toBe(true);
    expect(isTransient(new PayPalError(429, "Rate limit reached"))).toBe(true);
    expect(isTransient(new PayPalError(401, "Authentication failed"))).toBe(true);
    expect(isTransient(new TypeError("fetch failed"))).toBe(true);
    expect(isTransient(new Error("PayPal auth failed (500)"))).toBe(true);
  });

  it("fails the pass when PayPal rejects the request itself", () => {
    expect(isTransient(new PayPalError(400, "Receiver is invalid or does not match with type"))).toBe(false);
    expect(isTransient(new PayPalError(422, "Unprocessable entity"))).toBe(false);
  });

  it("recognizes a retry that found the first attempt already went through", () => {
    const body = JSON.stringify({
      name: "USER_BUSINESS_ERROR",
      details: [{ field: "SENDER_BATCH_ID", issue: "Batch with given sender_batch_id already exists" }],
    });
    expect(isDuplicateBatch(new PayPalError(400, "Batch with given sender_batch_id already exists", body))).toBe(true);
    expect(isDuplicateBatch(new PayPalError(400, "Receiver is invalid"))).toBe(false);
    expect(isDuplicateBatch(new PayPalError(503, "duplicate"))).toBe(false);
  });
});
