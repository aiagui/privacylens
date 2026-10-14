import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateReport } from "../src/report/validate";

const doc = readFileSync("docs/report-format.md", "utf8");

describe("docs/report-format.md", () => {
  it("contains an example that the validator accepts", () => {
    const block = /```json\n([\s\S]*?)```/.exec(doc)?.[1];
    expect(block).toBeDefined();
    const result = validateReport(JSON.parse(block!));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.report.technologies[0]?.observation).toBe("observed");
  });

  it("documents every top-level field, version and evidence class", () => {
    for (const field of [
      "schemaVersion",
      "targetUrl",
      "scannedAt",
      "status",
      "technologies",
      "cookies",
      "thirdPartyRequests",
      "cmp",
      "concerns",
      "limitations",
      "signatureSetVersion",
      "provenance",
    ])
      expect(doc, field).toContain(`\`${field}\``);
    for (const word of [
      "observed",
      "inferred",
      "unknown",
      "completed",
      "failed",
      "blocked",
    ])
      expect(doc).toContain(`\`${word}\``);
    expect(doc).toContain("schema version 1");
  });
});
