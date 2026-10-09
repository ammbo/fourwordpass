import { afterEach, describe, expect, it, vi } from "vitest";
import { captureOrder, createOrder, createPayout, getPayout, paypalMode, PayPalError, isDuplicateBatch, isTransient } from "../worker/paypal";

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

afterEach(()=>vi.unstubAllGlobals());
describe('payment environment boundaries',()=>{
  it('requires explicit mock mode and fails closed on missing credentials',()=>{
    expect(paypalMode({PAYPAL_MODE:'mock'} as Env)).toBe('mock');
    for(const mode of ['live','sandbox','typo',undefined]) {
      expect(()=>paypalMode({PAYPAL_MODE:mode} as Env)).toThrow();
    }
    expect(paypalMode({PAYPAL_MODE:'sandbox',PAYPAL_CLIENT_ID:'client',PAYPAL_CLIENT_SECRET:'secret'} as Env)).toBe('sandbox');
  });
  it('prevents new live charges and payouts while the funding model is unfinished',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const env={PAYPAL_MODE:'live',PAYPAL_CLIENT_ID:'live-client',PAYPAL_CLIENT_SECRET:'live-secret'} as Env;
    await expect(createOrder(env,'mint')).rejects.toThrow('paused');
    await expect(captureOrder(env,'order')).rejects.toThrow('paused');
    await expect(createPayout(env,{passId:'p',email:'reader@example.com',note:'',subject:'',message:'',since:0})).rejects.toThrow('paused');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not accept simulated payout receipts in sandbox mode',async()=>{
    const env={PAYPAL_MODE:'sandbox',PAYPAL_CLIENT_ID:'client',PAYPAL_CLIENT_SECRET:'secret'} as Env;
    await expect(getPayout(env,'MOCK123S')).rejects.toThrow('off');
  });
  it('recovers a completed capture after its acknowledgement was lost',async()=>{
    const env={PAYPAL_MODE:'sandbox',PAYPAL_CLIENT_ID:'capture-client',PAYPAL_CLIENT_SECRET:'secret'} as Env;
    const fetch=vi.fn().mockResolvedValueOnce(Response.json({access_token:'token',expires_in:3600}))
      .mockResolvedValueOnce(Response.json({message:'Order already captured'},{status:422}))
      .mockResolvedValueOnce(Response.json({status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'capture',status:'COMPLETED',amount:{value:'2.00',currency_code:'USD'}}]}}]}));
    vi.stubGlobal('fetch',fetch);
    expect(await captureOrder(env,'order')).toBe('capture');
    expect(fetch.mock.calls[1][1].headers['PayPal-Request-Id']).toBe('cap-order');
    expect(fetch.mock.calls[2][0]).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders/order');
  });
});
