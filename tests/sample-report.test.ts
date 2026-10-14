import { describe, expect, it } from "vitest";
import { assessRequest } from "../src/scanner/detectors";
import { SIGNATURE_SET_VERSION, signatures } from "../src/scanner/signatures";
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

  it("carries classifications that the scanner would reproduce", () => {
    // Sample requests store origins only, so each is paired with a
    // representative URL; the classification must match assessRequest().
    const representative: Record<string, [string, string]> = {
      "www.googletagmanager.com": [
        "https://www.googletagmanager.com/gtag/js?id=G-X",
        "script",
      ],
      "www.google-analytics.com": [
        "https://www.google-analytics.com/g/collect?v=2",
        "fetch",
      ],
      "www.facebook.com": ["https://www.facebook.com/tr?id=1", "fetch"],
      "www.clarity.ms": ["https://www.clarity.ms/tag/abc", "script"],
      "cdn.assets-sample.example": [
        "https://cdn.assets-sample.example/app.js",
        "image",
      ],
    };
    expect(SAMPLE_REPORT.signatureSetVersion).toBe(SIGNATURE_SET_VERSION);
    for (const request of SAMPLE_REPORT.thirdPartyRequests) {
      const entry = representative[request.domain];
      expect(entry, request.domain).toBeDefined();
      const [address, resourceType] = entry as [string, string];
      const assessment = assessRequest(new URL(address), resourceType);
      expect(request.classification, request.domain).toBe(
        assessment.classification,
      );
      expect(request.technology, request.domain).toBe(
        assessment.technology?.name,
      );
      expect(resourceType, request.domain).toBe(request.resourceType);
    }
    expect(
      SAMPLE_REPORT.thirdPartyRequests.map((request) => request.classification),
    ).toEqual(expect.arrayContaining(["observed", "inferred", "unknown"]));
  });

  it("references registered signatures at the current version", () => {
    for (const technology of SAMPLE_REPORT.technologies) {
      expect(
        signatures.some((entry) => entry.id === technology.signature?.id),
        technology.name,
      ).toBe(true);
      expect(technology.signature?.version).toBe(SIGNATURE_SET_VERSION);
    }
  });
});
