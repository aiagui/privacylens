import {
  validateReport,
  type ValidationIssue,
  type ValidationResult,
} from "./validate";

/** Largest report file the importer will read. Real reports are well under 1 MB. */
export const MAX_REPORT_BYTES = 5 * 1024 * 1024;

export type ImportResult =
  | { ok: true; report: Extract<ValidationResult, { ok: true }>["report"] }
  | { ok: false; issues: ValidationIssue[]; truncated: boolean };

const fail = (message: string, path = ""): ImportResult => ({
  ok: false,
  issues: [{ path: path || "(file)", message }],
  truncated: false,
});

/** Parses and validates file contents. Never throws. */
export function parseReportText(content: string): ImportResult {
  // A byte-order mark is harmless and common on Windows; anything else is not JSON.
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  if (text.trim() === "") return fail("The file is empty.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail(
      "The file is not valid JSON. Open a report produced by `npm run scan`.",
    );
  }
  return validateReport(data);
}

/**
 * Reads a user-chosen file in this browser tab only. The size is checked before
 * the contents are read, and nothing is sent, stored or cached.
 */
export async function readReportFile(file: {
  size: number;
  text: () => Promise<string>;
}): Promise<ImportResult> {
  if (file.size > MAX_REPORT_BYTES)
    return fail(
      `The file is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Reports are limited to ${MAX_REPORT_BYTES / 1024 / 1024} MB.`,
    );
  if (file.size === 0) return fail("The file is empty.");
  let content: string;
  try {
    content = await file.text();
  } catch {
    return fail("The file could not be read.");
  }
  // text() can in principle return more than size claimed for odd sources.
  if (content.length > MAX_REPORT_BYTES)
    return fail("The file is too large to open.");
  return parseReportText(content);
}
