import { describe, expect, it } from "vitest";
import { checkFinale, checkFourWords, maskEmail, tokenize } from "../shared/words";
import { closingBudget, trimToContent } from "../worker/ai";
import { isClean } from "../worker/moderation";

describe("four-word rule", () => {
  it("lets stopwords ride free", () => {
    const r = checkFourWords("the robot learned to dream tonight");
    expect(r.content).toBe(4);
    expect(r.ok).toBe(true);
  });
  it("rejects too few content words with the house copy", () => {
    const r = checkFourWords("and then the lights dimmed");
    expect(r.content).toBe(2);
    expect(r.error).toBe("That's 2 content words. The buck demands four.");
  });
  it("caps raw words at eight", () => {
    expect(checkFourWords("the the the the robot learned dream tonight").ok).toBe(true);
    expect(checkFourWords("the the the the the robot learned dream tonight").ok).toBe(false);
  });
  it("counts hyphenated words once and ignores punctuation-only tokens", () => {
    const r = checkFourWords("a well-worn map — folded twice!");
    expect(r.content).toBe(4);
    expect(r.ok).toBe(true);
  });
  it("strips surrounding punctuation for counting but keeps it for display", () => {
    expect(tokenize('"The end," she said.').map((t) => t.norm)).toEqual(["the", "end", "she", "said"]);
  });
  it("handles curly apostrophes as one word", () => {
    expect(checkFourWords("don’t open the red door").content).toBe(4);
  });
  it("rejects links and emails", () => {
    expect(checkFourWords("visit my site example.com now").ok).toBe(false);
    expect(checkFourWords("email me at bob@x.io").ok).toBe(false);
  });
  it("finale allows 1-12 content words", () => {
    expect(checkFinale("The end.").ok).toBe(true);
    expect(checkFinale("one two three four five six seven eight nine ten eleven twelve thirteen").ok).toBe(false);
  });
});

describe("AI closing budget", () => {
  it("is ~5% of story words, between 1 and 12", () => {
    expect(closingBudget(20)).toBe(1);
    expect(closingBudget(100)).toBe(5);
    expect(closingBudget(4000)).toBe(12);
  });
  it("trims to the content budget", () => {
    expect(trimToContent("and so the robot finally slept forever and ever", 3)).toBe("and so the robot finally.");
  });
});

describe("moderation", () => {
  it("blocks harsh profanity and slurs, allows mild", () => {
    expect(isClean("damn the hell out")).toBe(true);
    expect(isClean("what the fuuuck")).toBe(false);
    expect(isClean("sh1t happens")).toBe(false);
  });
});

it("masks emails", () => {
  expect(maskEmail("jane@gmail.com")).toBe("j•••@g•••.com");
});
