// One place for the name. The product is Four Word Pass; "pass the buck" is the verb.
export const BRAND = "Four Word Pass";
export const SERIAL_PREFIX = "FWP";
export const TAGLINE = "Pass the buck. Four words at a time.";
export const MINT_PRICE = "2.00";
export const HOP_AMOUNT = "1.00";

export function serialFor(seq: number): string {
  return `${SERIAL_PREFIX}-${String(seq).padStart(4, "0")}`;
}
