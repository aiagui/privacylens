import { describe, expect, it } from "vitest";
import { SAMPLE_REPORT } from "../src/sample-report";

describe("bundled sample report", () => {
  it("never points at a real, resolvable domain", () => {
    // RFC 2606 reserves .example for documentation; this guards against the
    // sample ever being swapped for data captured from a real scan.
    expect(new URL(SAMPLE_REPORT.targetUrl).hostname.endsWith(".example")).toBe(
      true,
    );
  });

  it("covers every report section with non-empty, evidence-labeled content", () => {
    expect(SAMPLE_REPORT.technologies.length).toBeGreaterThan(0);
    expect(SAMPLE_REPORT.cookies.length).toBeGreaterThan(0);
    expect(SAMPLE_REPORT.thirdPartyRequests.length).toBeGreaterThan(0);
    expect(SAMPLE_REPORT.cmp.detected).toBe(true);
    expect(SAMPLE_REPORT.concerns.length).toBeGreaterThan(0);
    expect(SAMPLE_REPORT.limitations.length).toBeGreaterThan(0);
    for (const technology of SAMPLE_REPORT.technologies) {
      expect(["observed", "inferred"]).toContain(technology.observation);
      expect(technology.evidence.length).toBeGreaterThan(0);
    }
  });

  it("labels itself as sample data in its own limitations", () => {
    expect(
      SAMPLE_REPORT.limitations.some((limitation) =>
        limitation.toLowerCase().includes("sample"),
      ),
    ).toBe(true);
  });
});
