import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  DEFAULT_SETTLE_MS,
  DEFAULT_TIMEOUT_MS,
  parseTargetUrl,
  redactUrls,
  scanLive,
} from "../scanner/scan-live.ts";
import type { ScanReport } from "../scanner/types.ts";
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
      --settle <sec>    Wait after page load for delayed requests, 0 to 30 (default ${DEFAULT_SETTLE_MS / 1000})
  -h, --help            Show this help
  -v, --version         Show the version

The scan covers the initial page load only; nothing on the page is clicked.
Connections to private, local and other non-public addresses are always refused.
Reports record origins, cookie names and attributes, and request timing. They do
not record cookie values, request payloads, headers, URL paths or query strings.
Setup: run "npx playwright install chromium" once.
`;

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
        timeout: { type: "string" },
        settle: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    io.stderr(`${redactUrls((error as Error).message)}\n\n${USAGE}`);
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
    target = parseTargetUrl(positionals[1] ?? "");
  } catch (error) {
    io.stderr(`${redactUrls((error as Error).message)}\n`);
    return EXIT.usage;
  }

  io.stderr(
    `Scanning ${target.origin} with headless Chromium (local egress filter on)...\n`,
  );
  let report: ScanReport;
  try {
    report = await (io.scan ?? scanLive)(target.toString(), {
      timeoutMs,
      settleMs,
      scannerVersion: io.version,
    });
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      io.stderr(`Refused: ${redactUrls(error.message)}.\n`);
      return EXIT.refused;
    }
    const message = redactUrls(
      error instanceof Error ? error.message : String(error),
    );
    io.stderr(
      /Executable doesn't exist|browserType\.launch/i.test(message)
        ? 'Chromium is not installed. Run "npx playwright install chromium" and try again.\n'
        : `Scan failed: ${message}\n`,
    );
    return EXIT.failed;
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.out) {
    try {
      writeFileSync(values.out, json, { flag: values.force ? "w" : "wx" });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      io.stderr(
        code === "EEXIST"
          ? `Not overwriting ${values.out}; use --force to replace it.\n`
          : `Could not write the report: ${code ?? "unknown error"}\n`,
      );
      return EXIT.failed;
    }
    io.stderr(`Report written to ${values.out}\n`);
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
