import { describe, expect, it } from "vitest";
import { SPEECH_RATE_MAX, SPEECH_RATE_MIN, speechRateFromWpm, splitUtterance, textToSpeak } from "./speech";

describe("speechRateFromWpm", () => {
  it("is wpm / 180", () => {
    expect(speechRateFromWpm(180)).toBe(1);
    expect(speechRateFromWpm(300)).toBeCloseTo(300 / 180, 10);
    expect(speechRateFromWpm(450)).toBeCloseTo(2.5, 10);
  });
  it("is clamped to the Web Speech range", () => {
    expect(speechRateFromWpm(1)).toBe(SPEECH_RATE_MIN);
    expect(speechRateFromWpm(100000)).toBe(SPEECH_RATE_MAX);
  });
  it("falls back to 1 for junk input", () => {
    expect(speechRateFromWpm(0)).toBe(1);
    expect(speechRateFromWpm(Number.NaN)).toBe(1);
  });
});

describe("splitUtterance", () => {
  it("keeps whole announcements that were not truncated", () => {
    const p = splitUtterance({ text: "button, Add to cart", seconds: 0.9, truncated: false }, 300);
    expect(p).toEqual({ heard: "button, Add to cart", cut: "", fraction: 1 });
  });
  it("cuts truncated announcements proportionally to the time listened", () => {
    // 8 words at 300 wpm = 1.6 s; listening 0.8 s keeps half the words.
    const p = splitUtterance(
      { text: "navigation landmark, list with 10 items, link, Men", seconds: 0.8, truncated: true },
      300,
    );
    expect(p.heard).toBe("navigation landmark, list with");
    expect(p.cut).toBe("10 items, link, Men");
    expect(p.fraction).toBeCloseTo(0.5, 5);
  });
  it("always keeps at least one word", () => {
    const p = splitUtterance({ text: "link, Jackets", seconds: 0.01, truncated: true }, 300);
    expect(p.heard).toBe("link,");
    expect(p.cut).toBe("Jackets");
  });
  it("treats listening for the full duration as not cut", () => {
    const p = splitUtterance({ text: "link, Men", seconds: 5, truncated: true }, 300);
    expect(p.cut).toBe("");
    expect(textToSpeak({ text: "link, Men", seconds: 5, truncated: true }, 300)).toBe("link, Men");
  });
});
