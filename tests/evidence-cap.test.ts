import { describe, expect, it } from "vitest";
import { addEvidence } from "../src/scanner/scan-live";

describe("addEvidence", () => {
  const fill = (n: number) =>
    Array.from({ length: n }).reduce<string[]>(
      (lines, _, i) => addEvidence(lines, `line ${i}`),
      [],
    );

  it("keeps every distinct line up to the cap and ignores duplicates", () => {
    expect(fill(50)).toHaveLength(50);
    expect(addEvidence(fill(3), "line 1")).toHaveLength(3);
  });

  it("stays bounded no matter how many distinct destinations a page contacts", () => {
    const lines = fill(5000);
    expect(lines.length).toBeLessThanOrEqual(51);
    expect(lines.at(-1)).toBe("And 4950 more similar requests are not listed.");
  });

  it("keeps the first lines and counts the rest", () => {
    const lines = fill(60);
    expect(lines[0]).toBe("line 0");
    expect(lines[49]).toBe("line 49");
    expect(lines.at(-1)).toBe("And 10 more similar requests are not listed.");
  });

  it("does not let a repeat of an already listed line change the count", () => {
    const lines = fill(60);
    expect(addEvidence(lines, "line 3")).toEqual(lines);
  });
});
