import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  DEFAULT_SETTLE_MS,
  DEFAULT_TIMEOUT_MS,
  ScanLimitError,
  parseTargetUrl,
  redactUrls,
  scanLive,
} from "../scanner/scan-live.ts";
import type { ScanReport } from "../scanner/types.ts";
import { isUnsafeCharacter } from "../report/text.ts";
import { validateReport } from "../report/validate.ts";
import { UnsafeTargetError } from "../scanner/url-policy.ts";

export const EXIT = { ok: 0, failed: 1, usage: 2, refused: 3 } as const;

export const USAGE = `PrivacyLens local scanner

Usage:
  npm run scan -- <url> [options]

Scans one public website with headless Chromium on this machine and prints an
evidence report as JSON on standard output. Progress goes to standard error.

Options:
  -o, --out <file>      Write the report to a file instead of standard output
      --force           Overwrite the output file if it exists
      --timeout <sec>   Overall time limit, 5 to 120 (default ${DEFAULT_TIMEOUT_MS / 1000})
      --settle <sec>    Wait after page load for delayed requests, 0 to 30 (default ${DEFAULT_SETTLE_MS / 1000});
                        must leave at least 2 seconds of --timeout
      --unsafe-no-sandbox
                        Run Chromium without its process sandbox. Only if the
                        sandbox cannot start; a browser exploit would then run
                        with your privileges
  -h, --help            Show this help
  -v, --version         Show the version

The scan covers the initial page load only; nothing on the page is clicked.
Connections to private, local and other non-public addresses are always refused.
Reports record origins, cookie names and attributes, and request timing. They do
not record cookie values, request payloads, headers, URL paths or query strings.
Setup: run "npx playwright install chromium" once.
`;

/**
 * Anything that did not come from this program's own text (error messages,
 * file names) is stripped of control characters before it reaches a terminal:
 * escape sequences could clear the screen, retitle the window or forge lines.
 */
export function plain(text: string, max = 400): string {
  const cleaned = [...text]
    .map((character) =>
      isUnsafeCharacter(character.codePointAt(0) ?? 0) ? " " : character,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}...` : cleaned;
}

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  scan?: typeof scanLive;
  version?: string;
}

function seconds(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max)
    throw new RangeError(`--${name} must be a number from ${min} to ${max}`);
  return Math.round(parsed * 1000);
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: "string", short: "o" },
        force: { type: "boolean" },
        "unsafe-no-sandbox": { type: "boolean" },
        timeout: { type: "string" },
        settle: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    io.stderr(`${plain(redactUrls((error as Error).message))}\n\n${USAGE}`);
    return EXIT.usage;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(USAGE);
    return EXIT.ok;
  }
  if (values.version) {
    io.stdout(`${io.version ?? "unknown"}\n`);
    return EXIT.ok;
  }
  if (positionals.length !== 2 || positionals[0] !== "scan") {
    io.stderr(`Expected: scan <url>\n\n${USAGE}`);
    return EXIT.usage;
  }

  let timeoutMs: number;
  let settleMs: number;
  let target: URL;
  try {
    timeoutMs = seconds(values.timeout, DEFAULT_TIMEOUT_MS, 5, 120, "timeout");
    settleMs = seconds(values.settle, DEFAULT_SETTLE_MS, 0, 30, "settle");
    if (settleMs + 2_000 > timeoutMs)
      throw new RangeError(
        "--settle must leave at least 2 seconds of --timeout",
      );
    if (values.out !== undefined && values.out.trim() === "")
      throw new RangeError("--out needs a file name");
    target = parseTargetUrl(positionals[1] ?? "");
  } catch (error) {
    io.stderr(`${plain(redactUrls((error as Error).message))}\n`);
    return EXIT.usage;
  }
  if (values["unsafe-no-sandbox"])
    io.stderr(
      "Warning: Chromium's process sandbox is disabled. A browser exploit would run with your privileges.\n",
    );

  io.stderr(
    `Scanning ${target.origin} with headless Chromium (local egress filter on)...\n`,
  );
  let report: ScanReport;
  try {
    report = await (io.scan ?? scanLive)(target.toString(), {
      timeoutMs,
      settleMs,
      scannerVersion: io.version,
      chromiumSandbox: !values["unsafe-no-sandbox"],
    });
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      io.stderr(`Refused: ${plain(redactUrls(error.message))}.\n`);
      return EXIT.refused;
    }
    const message = plain(
      redactUrls(error instanceof Error ? error.message : String(error)),
    );
    io.stderr(
      error instanceof ScanLimitError
        ? `Stopped: ${message}.\n`
        : /Executable doesn't exist/i.test(message)
          ? 'Chromium is not installed. Run "npx playwright install chromium" and try again.\n'
          : `Scan failed: ${message}\n`,
    );
    return EXIT.failed;
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  // The scanner is meant to write only what the web importer accepts. If a value
  // slips through, say so now instead of leaving a file that fails to open later.
  // Check the text that is actually written, not the in-memory object: JSON drops
  // keys whose value is undefined, so only the written form is what gets imported.
  const check = validateReport(JSON.parse(json));
  if (!check.ok) {
    const first = check.issues
      .slice(0, 3)
      .map((issue) => `${plain(issue.path, 80)} ${plain(issue.message, 120)}`)
      .join("; ");
    io.stderr(
      `Warning: this report does not match the report format, so the web importer may refuse it (${first}). Please report this as a bug.\n`,
    );
  }
  if (values.out) {
    try {
      writeFileSync(values.out, json, { flag: values.force ? "w" : "wx" });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      io.stderr(
        code === "EEXIST"
          ? `Not overwriting ${plain(values.out)}; use --force to replace it.\n`
          : `Could not write the report: ${plain(code ?? "unknown error")}\n`,
      );
      return EXIT.failed;
    }
    io.stderr(`Report written to ${plain(values.out)}\n`);
  } else {
    io.stdout(json);
  }
  return EXIT.ok;
}

function packageVersion(): string {
  try {
    const raw = readFileSync(
      new URL("../../package.json", import.meta.url),
      "utf8",
    );
    return (JSON.parse(raw) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    version: packageVersion(),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = EXIT.failed;
    },
  );
}
