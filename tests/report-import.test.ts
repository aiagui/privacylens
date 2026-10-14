import { describe, expect, it, vi } from "vitest";
import {
  MAX_REPORT_BYTES,
  parseReportText,
  readReportFile,
} from "../src/report/import";
import { SAMPLE_REPORT } from "../src/sample-report";

const json = JSON.stringify(SAMPLE_REPORT);
const BOM = String.fromCharCode(0xfeff);

describe("parseReportText", () => {
  it("parses a valid report, with or without a byte-order mark and with indentation", () => {
    expect(parseReportText(json).ok).toBe(true);
    expect(parseReportText(`${BOM}${json}`).ok).toBe(true);
    expect(
      parseReportText(JSON.stringify(SAMPLE_REPORT, null, 2) + "\n").ok,
    ).toBe(true);
  });

  it.each(["", "   \n\t", "\ufeff"])("rejects empty content %j", (content) => {
    const result = parseReportText(content);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/empty/);
  });

  it.each([
    "not json",
    "{",
    "{'a':1}",
    "[1,",
    "undefined",
    "NaN",
    "<html>",
    "{}{}",
    json + "garbage",
  ])("rejects invalid JSON %j with a plain message", (content) => {
    const result = parseReportText(content);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/not valid JSON/);
  });

  it("rejects valid JSON that is not a report", () => {
    for (const content of ["null", "1", '"text"', "[]", "{}"]) {
      expect(parseReportText(content).ok, content).toBe(false);
    }
  });

  it("does not throw on extremely deep JSON", () => {
    const deep = "[".repeat(200_000) + "]".repeat(200_000);
    expect(() => parseReportText(deep)).not.toThrow();
    expect(parseReportText(deep).ok).toBe(false);
  });

  it("does not echo file content in its messages", () => {
    const result = parseReportText(
      '{"schemaVersion": 1, "secret-looking-key-SHOULD-NOT-APPEAR": 1}',
    );
    expect(result.ok).toBe(false);
  });
});

describe("readReportFile", () => {
  it("reads a valid file", async () => {
    const result = await readReportFile({
      size: json.length,
      text: async () => json,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an oversized file without reading it", async () => {
    const text = vi.fn(async () => json);
    const result = await readReportFile({ size: MAX_REPORT_BYTES + 1, text });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/too large/);
    expect(text).not.toHaveBeenCalled();
  });

  it("rejects an empty file without reading it", async () => {
    const text = vi.fn(async () => "");
    expect((await readReportFile({ size: 0, text })).ok).toBe(false);
    expect(text).not.toHaveBeenCalled();
  });

  it("accepts a file exactly at the limit as far as size goes", async () => {
    const result = await readReportFile({
      size: MAX_REPORT_BYTES,
      text: async () => "{",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/not valid JSON/);
  });

  it("reports a read failure instead of throwing", async () => {
    const result = await readReportFile({
      size: 10,
      text: async () => {
        throw new Error("boom with /private/path");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(JSON.stringify(result.issues)).not.toContain("/private/path");
  });

  it("rejects content longer than the declared size allows", async () => {
    const result = await readReportFile({
      size: 10,
      text: async () => "x".repeat(MAX_REPORT_BYTES + 1),
    });
    expect(result.ok).toBe(false);
  });
});
