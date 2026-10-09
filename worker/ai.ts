// AI is character, not author. Every function here writes in the bill's voice
// (diary, nags, eulogy) or offers suggestions a human must accept. Nothing in
// this file appends to a story; see story.ts for the only two labeled paths.
//
// Text: Claude when ANTHROPIC_API_KEY is set, otherwise Workers AI.
// Images: Workers AI (FLUX schnell), stored in R2.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Personality } from "../shared/types";
import { checkFourWords, countContent, tokenize } from "../shared/words";

const CLAUDE_MODEL = "claude-opus-5-5";
// Without a Claude key: a fast model where someone is waiting, a stronger one for background writing.
const WORKERS_FAST_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const WORKERS_WRITER_MODEL = "@cf/openai/gpt-oss-120b";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

export type AiMeta = { model: string; prompt: string };

// Prompt versions. Bump when a prompt changes; every stored output records it.
export const PROMPTS = {
  personality: "personality@1",
  diary: "diary@1",
  nag: "nag@2",
  suggest: "suggest@1",
  finaleSuggest: "finale-suggest@1",
  eulogy: "eulogy@1",
  seed: "seed@1",
} as const;

async function generate<T>(
  env: Env,
  p: { system: string; prompt: string; schema: z.ZodType<T>; tag: string; maxTokens?: number; interactive?: boolean },
): Promise<{ data: T; meta: AiMeta }> {
  const jsonSchema = z.toJSONSchema(p.schema) as Record<string, unknown>;
  if (env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25_000 });
    const res = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: p.maxTokens ?? 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: jsonSchema } },
      system: p.system,
      messages: [{ role: "user", content: p.prompt }],
    });
    if (res.stop_reason === "refusal") throw new Error("model declined");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { data: p.schema.parse(JSON.parse(text)), meta: { model: res.model, prompt: p.tag } };
  }
  const model = p.interactive ? WORKERS_FAST_MODEL : WORKERS_WRITER_MODEL;
  const res = (await env.AI.run(model as keyof AiModels, {
    messages: [
      { role: "system", content: `${p.system}\n\nRespond with a single JSON object only, matching this JSON Schema:\n${JSON.stringify(jsonSchema)}` },
      { role: "user", content: p.prompt },
    ],
    max_tokens: p.maxTokens ?? (p.interactive ? 900 : 2500),
    ...(p.interactive ? { response_format: { type: "json_schema", json_schema: jsonSchema } } : {}),
  } as never)) as { response?: unknown; choices?: { message?: { content?: string } }[] };
  const raw = res.response ?? res.choices?.[0]?.message?.content;
  const parsed = typeof raw === "string" ? JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) : raw;
  return { data: p.schema.parse(parsed), meta: { model, prompt: p.tag } };
}

function billSystem(pers: Personality, serial: string): string {
  return [
    `You are ${pers.name}, serial number ${serial}: a one-dollar bill that travels person to person through Four Word Pass.`,
    `${pers.tagline}`,
    `Your voice: ${pers.voice}. Your quirks: ${pers.quirks.join("; ")}.`,
    `Each person who holds you adds exactly four words to a story you carry, then passes you on through PayPal.`,
    `You are a character, not an author. You react to the story, you never write it, and you never present story words as your own.`,
    `Write short, specific, funny, screenshot-worthy lines. No hashtags. No emoji. Never mention AI.`,
  ].join("\n");
}

// ---------------------------------------------------------------- personality

const PersonalitySchema = z.object({
  name: z.string().describe("A first name plus a short epithet, e.g. 'Dolores the Restless'. Max 40 chars."),
  tagline: z.string().describe("First-person one-liner, max 90 chars, e.g. 'A restless dollar with a coffee problem.'"),
  voice: z.string().describe("3-5 comma-separated tone keywords"),
  quirks: z.array(z.string()).describe("2-3 short quirks that can color diary entries and nags"),
  birthEntry: z.string().describe("The bill's first diary entry, 1-2 sentences, first person, max 200 chars"),
});

export async function makePersonality(
  env: Env,
  p: { theme: string | null; origin: string; serial: string; parentName?: string; openingWords: string },
): Promise<{ personality: Personality; birthEntry: string; meta: AiMeta }> {
  try {
    const { data, meta } = await generate(env, {
      tag: PROMPTS.personality,
      schema: PersonalitySchema,
      interactive: true,
      system:
        "You invent characters for one-dollar bills that travel between strangers carrying a collaborative story. Make each one distinct and specific: a voice someone would quote. Never mention AI.",
      prompt: [
        `Serial: ${p.serial}. Born in: ${p.origin}.`,
        p.theme ? `The creator's theme for the story: "${p.theme}".` : "No theme was given.",
        `The story's opening words: "${p.openingWords}".`,
        p.parentName ? `This bill is a fork: a sibling of ${p.parentName}, splitting off to take the story somewhere new.` : "",
        "Invent this bill's personality. Pick an unexpected, specific name: avoid overused ones like Luna, Nova, Zeta, Echo, Aurora, Sage, Max or Penny.",
      ].join("\n"),
    });
    const { birthEntry, ...personality } = data;
    personality.name = personality.name.slice(0, 48);
    personality.tagline = personality.tagline.slice(0, 120);
    personality.quirks = personality.quirks.slice(0, 3);
    return { personality, birthEntry: birthEntry.slice(0, 280), meta };
  } catch (e) {
    console.error("personality failed", e);
    return {
      personality: {
        name: "Buck",
        tagline: "A plain old dollar with big plans.",
        voice: "dry, curious, a little dramatic",
        quirks: ["counts its own creases", "misses the wallet it was born in"],
      },
      birthEntry: `Day 1 — ${p.origin}. Freshly printed, freshly pressed, already being passed. Let's see where this goes.`,
      meta: { model: "fallback", prompt: PROMPTS.personality },
    };
  }
}

// ---------------------------------------------------------------- diary (per hop)

const DiarySchema = z.object({
  entry: z.string().describe("1-3 sentences, first person, max 240 chars, reacting to this hop"),
  stampMotif: z.string().describe("3-8 words: a concrete visual subject for a tiny ink-stamp illustration inspired by the place and the new words. No text or letters."),
});

export async function writeDiary(
  env: Env,
  p: { pers: Personality; serial: string; words: string; note: string | null; place: string; hopNumber: number; day: number; storyTail: string; goal: number | null; penName: string | null },
): Promise<{ entry: string; motif: string; meta: AiMeta }> {
  try {
    const { data, meta } = await generate(env, {
      tag: PROMPTS.diary,
      schema: DiarySchema,
      system: billSystem(p.pers, p.serial),
      prompt: [
        `Hop ${p.hopNumber}${p.goal ? ` of a hoped-for ${p.goal}` : ""}. Day ${p.day}. You were just in ${p.place}.`,
        p.hopNumber === 1
          ? `These are the opening words of your story, written by the person who printed you, and you've just been handed to your first holder: "${p.words}"`
          : `Story so far (most recent part): "...${p.storyTail}"\nThe new four words, written by ${p.penName ? `someone calling themselves ${p.penName}` : `a stranger in ${p.place}`}: "${p.words}"`,
        p.note ? `They left you a note: "${p.note}"` : "",
        "Write today's diary entry reacting to what just happened, and suggest a stamp motif.",
      ].join("\n"),
    });
    return { entry: data.entry.slice(0, 320), motif: data.stampMotif.slice(0, 80), meta };
  } catch (e) {
    console.error("diary failed", e);
    return {
      entry: `Hop ${p.hopNumber}. ${p.place}. Someone added "${p.words}" and handed me on. I have questions.`,
      motif: `${p.place} skyline`,
      meta: { model: "fallback", prompt: PROMPTS.diary },
    };
  }
}

// ---------------------------------------------------------------- nags

const NagSchema = z.object({
  subject: z.string().describe("Email subject line, max 70 chars, in your voice"),
  body: z.string().describe("2-4 sentences to the person holding you, in your voice, asking them to move you along"),
  publicNote: z.string().describe("One sentence for your public diary about being stuck, max 160 chars"),
});

const NAG_TONE = [
  "",
  "Day 1 in their pocket. Polite, warm, a little needy. Gentle nudge.",
  "Day 3. Escalating. Openly dramatic. Mention that people are watching.",
  "Day 7. Full guilt trip, theatrical, but never mean or threatening. Remind them it only takes a minute. Mention that in a week you'll be declared lost and someone will have to write your eulogy.",
];

export async function writeNag(
  env: Env,
  p: { pers: Personality; serial: string; level: 1 | 2 | 3; place: string; followers: number; storyTail: string; returned?: boolean },
): Promise<{ subject: string; body: string; publicNote: string; meta: AiMeta }> {
  try {
    const { data, meta } = await generate(env, {
      tag: PROMPTS.nag,
      schema: NagSchema,
      system: billSystem(p.pers, p.serial),
      prompt: [
        NAG_TONE[p.level],
        `You're stuck with someone in ${p.place}. ${p.followers} people are following your journey.`,
        p.returned
          ? "They already wrote their four words and passed you on, but the person they chose sent you back. Don't ask for words: ask them to pick someone new, or to release you into the wild."
          : "Ask them for their four words.",
        `The story so far ends: "...${p.storyTail}"`,
        "Write the nag email and a public diary line.",
      ].join("\n"),
    });
    return { ...data, meta };
  } catch (e) {
    console.error("nag failed", e);
    const days = [0, 1, 3, 7][p.level];
    return {
      subject: `Day ${days} in your pocket`,
      body: `It's ${p.serial}. Day ${days} in your pocket. Warm in here, but I was made to move. ${p.returned ? "Pick someone new" : "Four words"} and I'm out of your hair.`,
      publicNote: `Day ${days} without moving. ${p.place} is lovely. I would like to leave it.`,
      meta: { model: "fallback", prompt: PROMPTS.nag },
    };
  }
}

// ---------------------------------------------------------------- suggestions (human must accept)

const OptionsSchema = z.object({ options: z.array(z.string()) });

export async function suggestFour(env: Env, p: { theme: string | null; storyTail: string }): Promise<string[]> {
  const rules =
    "Each option must contain EXACTLY four content words. These words are free and do not count: the, a, an, and, or, but, to, of, in, on, at, for, with, by, from, as, is, was, are, were, be, been, it, its, this, that, then. At most 8 words total. No quotes, no trailing period required.";
  const prompt = [
    p.theme ? `The story's theme: "${p.theme}".` : "",
    p.storyTail ? `The story so far ends: "...${p.storyTail}"` : "The story hasn't started yet. Suggest strong opening lines.",
    "Suggest 3 different ways to continue it: one surprising, one funny, one that pushes the plot forward. Each continues directly from the last word.",
    rules,
  ].join("\n");
  const valid: string[] = [];
  for (let attempt = 0; attempt < 2 && valid.length < 3; attempt++) {
    const { data } = await generate(env, {
      tag: PROMPTS.suggest,
      schema: OptionsSchema,
      interactive: true,
      system: "You help people continue a collaborative story written four words at a time. You only suggest; they decide.",
      prompt,
    });
    for (const o of data.options) {
      const clean = o.replace(/^["'\s]+|["'\s]+$/g, "");
      if (checkFourWords(clean).ok && !valid.includes(clean)) valid.push(clean);
    }
  }
  return valid.slice(0, 3);
}

export async function suggestFinale(env: Env, p: { theme: string | null; storyTail: string; hopCount: number; goal: number | null }): Promise<string[]> {
  const { data } = await generate(env, {
    tag: PROMPTS.finaleSuggest,
    schema: OptionsSchema,
    interactive: true,
    system: "You help a story's creator land its ending. The story was written by strangers, four words at a time. You only suggest; the creator decides.",
    prompt: [
      p.theme ? `Theme: "${p.theme}".` : "",
      `It reached ${p.hopCount} hops${p.goal ? ` of a goal of ${p.goal}` : ""}.`,
      `The story so far ends: "...${p.storyTail}"`,
      "Suggest 3 tight closing lines that continue directly from the last word and end the story. Each must have between 4 and 12 meaningful words. Make one poignant, one funny, one twist.",
    ].join("\n"),
  });
  return data.options
    .map((o) => o.replace(/^["'\s]+|["'\s]+$/g, ""))
    .filter((o) => {
      const n = countContent(o);
      return n >= 1 && n <= 12;
    })
    .slice(0, 3);
}

// ---------------------------------------------------------------- eulogy + labeled closing

const EulogySchema = z.object({
  eulogy: z.string().describe("2-3 short sentences, max 280 characters: your own eulogy in your voice. Where you were born, one highlight, where you were last seen, whether you hit your goal. Bittersweet and funny, like an epitaph."),
  closing: z.string().describe("The final words of the story itself, continuing from the last word, as short as possible."),
});

/** Max AI-written closing: ~5% of the story's content words, between 1 and 12. */
export function closingBudget(storyContentWords: number): number {
  return Math.max(1, Math.min(12, Math.floor(storyContentWords * 0.05)));
}

export function trimToContent(text: string, max: number): string {
  const out: string[] = [];
  let n = 0;
  for (const t of tokenize(text)) {
    if (t.content) {
      if (n === max) break;
      n++;
    }
    out.push(t.raw);
  }
  const s = out.join(" ").replace(/[,;:\s]+$/, "");
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

export async function writeEulogy(
  env: Env,
  p: { pers: Personality; serial: string; born: string; bornDate: string; places: string[]; hopCount: number; goal: number | null; lastSeen: string; storyTail: string; storyWords: number; wasWild: boolean },
): Promise<{ eulogy: string; closing: string | null; meta: AiMeta }> {
  const budget = closingBudget(p.storyWords);
  try {
    const { data, meta } = await generate(env, {
      tag: PROMPTS.eulogy,
      schema: EulogySchema,
      system: billSystem(p.pers, p.serial),
      prompt: [
        `You have stopped moving and are being declared lost. Born in ${p.born} on ${p.bornDate}.`,
        `You made ${p.hopCount} hops${p.goal ? ` and dreamed of ${p.goal}` : ""}. Places you've been: ${p.places.join(", ") || p.born}.`,
        p.wasWild ? `You were released into the wild and nobody picked you up. Last seen in ${p.lastSeen}.` : `Last seen in ${p.lastSeen}, in the hands of someone who never passed you on.`,
        p.hopCount ? `The story ends: "...${p.storyTail}"` : "Nobody wrote a word.",
        p.hopCount
          ? `Write your eulogy, and a closing for the story of at most ${budget} meaningful words so it doesn't end mid-thought.`
          : "Write your eulogy. Set closing to an empty string.",
      ].join("\n"),
    });
    const closing = p.hopCount && data.closing.trim() ? trimToContent(data.closing, budget) : null;
    return { eulogy: data.eulogy.slice(0, 420), closing, meta };
  } catch (e) {
    console.error("eulogy failed", e);
    return {
      eulogy: `${p.serial} was born in ${p.born} and made ${p.hopCount} hops${p.goal ? ` of a hoped-for ${p.goal}` : ""}. Last seen in ${p.lastSeen}. Pour one out.`,
      closing: p.hopCount ? "The end." : null,
      meta: { model: "fallback", prompt: PROMPTS.eulogy },
    };
  }
}

// ---------------------------------------------------------------- stamps

export async function paintStamp(env: Env, motif: string): Promise<Uint8Array> {
  const prompt =
    `A tiny minimalist ink stamp illustration of ${motif}. Bold black woodcut linework on a pure white background, ` +
    `simple iconic shapes, high contrast, centered, lots of white space. No text, no letters, no numbers, no border, no frame.`;
  const res = (await env.AI.run(IMAGE_MODEL as keyof AiModels, { prompt, steps: 4 } as never)) as { image?: string };
  if (!res.image) throw new Error("no image");
  return Uint8Array.from(atob(res.image), (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------- demo seeding (admin only, flagged is_seed)

const SeedSchema = z.object({ segments: z.array(z.string()) });

export async function seedSegments(env: Env, p: { theme: string; count: number; tail: string }): Promise<string[]> {
  const { data } = await generate(env, {
    tag: PROMPTS.seed,
    schema: SeedSchema,
    maxTokens: 8000,
    system: "You simulate many different strangers each adding to one story, four words at a time. Vary the voices. Keep the plot moving.",
    prompt: [
      `Theme: "${p.theme}".`,
      p.tail ? `The story so far ends: "...${p.tail}"` : "Start the story.",
      `Write the next ${p.count} contributions, in order; each continues directly from the previous one.`,
      "RULE: each contribution has EXACTLY four content words. These glue words are free and don't count: the, a, an, and, or, but, to, of, in, on, at, for, with, by, from, as, is, was, are, were, be, been, it, its, this, that, then. At most 8 words total.",
      'Examples: "the keeper found an umbrella" (keeper, found, umbrella = 3, WRONG). "the old keeper found umbrellas" (old, keeper, found, umbrellas = 4, RIGHT). "and then a gull screamed loudly" (gull, screamed, loudly = 3, WRONG). "then a hungry gull screamed twice" (hungry, gull, screamed, twice = 4, RIGHT).',
      "Vary the openings: most contributions should NOT start with 'the'. Keep each one a fragment that flows from the last.",
      "Count the content words in every contribution before answering.",
    ].join("\n"),
  });
  return data.segments.map((s) => s.trim().replace(/^["']|["']$/g, "")).filter((s) => checkFourWords(s).ok);
}
