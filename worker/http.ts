// Request plumbing shared by the public routes and the account routes.

import { z } from "zod";
import { UserError } from "./engine";

export const ctxOf = (c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }) => ({ waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p) });
export const ip = (req: Request) => req.headers.get("cf-connecting-ip") ?? "local";

export async function limit(binding: RateLimit, key: string) {
  const { success } = await binding.limit({ key });
  if (!success) throw new UserError("Slow down a little. The buck isn't going anywhere.", 429);
}

export async function readBody<T extends z.ZodType>(c: {req: {json(): Promise<unknown>}}, schema: T): Promise<z.infer<T>> {
  let value: unknown;
  try { value = await c.req.json(); } catch { throw new UserError("Send a valid JSON request."); }
  const result = schema.safeParse(value);
  if (!result.success) throw new UserError(`Invalid ${result.error.issues[0]?.path.join(".") || "request"}: ${result.error.issues[0]?.message}`);
  return result.data;
}
