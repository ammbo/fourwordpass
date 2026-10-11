import { z } from "zod";

// Names are self-reported. Allow international names and punctuation, but no markup or controls.
const name = z.string().trim().max(80).refine(v => !/[<>\p{Cc}\p{Cf}]/u.test(v), "Use a name without markup or control characters.");
export const profileSchema = z.object({
  firstName: name.min(1, "Enter your first name so recipients recognize you."),
  lastName: name.optional().default(""),
});
export type ProfileName = z.infer<typeof profileSchema>;
export const optionalProfileFields = { firstName: name.optional(), lastName: name.optional() };
