import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { sandboxAvailable } from "./helpers/sandbox";
import { EXIT, plain, runCli } from "../src/cli/privacylens";
import { ScanLimitError } from "../src/scanner/scan-live";
import { SAMPLE_REPORT } from "../src/sample-report";
import { UnsafeTargetError } from "../src/scanner/url-policy";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function harness(scan?: Parameters<typeof runCli>[1]["scan"]) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => err.push(t),
      scan,
      version: "9.9.9",
    },
  };
}

const okScan = async () => SAMPLE_REPORT;

describe("cli arguments", () => {
  it("prints help and version", async () => {
    const h = harness();
    expect(await runCli(["--help"], h.io)).toBe(EXIT.ok);
    expect(h.out.join("")).toContain("Usage:");
    const v = harness();
    expect(await runCli(["--version"], v.io)).toBe(EXIT.ok);
    expect(v.out.join("")).toBe("9.9.9\n");
  });

  it.each([
    [[]],
    [["https://example.com"]],
    [["scan"]],
    [["scan", "a", "b"]],
    [["scan", "https://example.com", "--bogus"]],
    [["scan", "https://example.com", "--timeout", "1"]],
    [["scan", "https://example.com", "--timeout", "abc"]],
    [["scan", "https://example.com", "--settle", "99"]],
    [["scan", "ftp://example.com"]],
    [["scan", "https://user:pw@example.com"]],
    [["scan", "not a url"]],
  ])("exits with usage status for %j and never scans", async (argv) => {
    let scanned = false;
    const h = harness(async () => {
      scanned = true;
      return SAMPLE_REPORT;
    });
    expect(await runCli(argv, h.io)).toBe(EXIT.usage);
    expect(scanned).toBe(false);
    expect(h.out).toEqual([]);
  });
});

describe("cli output", () => {
  it("prints only the JSON report on stdout and progress on stderr", async () => {
    const h = harness(okScan);
    expect(
      await runCli(["scan", "https://example.com/path?token=abc"], h.io),
    ).toBe(EXIT.ok);
    expect(JSON.parse(h.out.join(""))).toEqual(SAMPLE_REPORT);
    expect(h.err.join("")).toContain("https://example.com");
    // The progress line names the origin only.
    expect(h.err.join("")).not.toMatch(/token=abc|\/path/);
  });

  it("passes limits and version to the scanner", async () => {
    let seen: unknown;
    const h = harness(async (_url, options) => {
      seen = options;
      return SAMPLE_REPORT;
    });
    await runCli(
      ["scan", "https://example.com", "--timeout", "10", "--settle", "0.5"],
      h.io,
    );
    expect(seen).toMatchObject({
      timeoutMs: 10_000,
      settleMs: 500,
      scannerVersion: "9.9.9",
    });
  });

  it("writes a file, and refuses to overwrite without --force", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pl-cli-"));
    dirs.push(dir);
    const file = join(dir, "report.json");
    const h = harness(okScan);
    expect(
      await runCli(["scan", "https://example.com", "-o", file], h.io),
    ).toBe(EXIT.ok);
    expect(h.out).toEqual([]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(SAMPLE_REPORT);

    writeFileSync(file, "keep me");
    const again = harness(okScan);
    expect(
      await runCli(["scan", "https://example.com", "-o", file], again.io),
    ).toBe(EXIT.failed);
    expect(readFileSync(file, "utf8")).toBe("keep me");
    const forced = harness(okScan);
    expect(
      await runCli(
        ["scan", "https://example.com", "-o", file, "--force"],
        forced.io,
      ),
    ).toBe(EXIT.ok);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(SAMPLE_REPORT);
  });
});

describe("cli failures", () => {
  it("maps a refused target to its own exit status", async () => {
    const h = harness(async () => {
      throw new UnsafeTargetError(
        "The target resolves to a non-public address and was refused",
      );
    });
    expect(await runCli(["scan", "https://example.com"], h.io)).toBe(
      EXIT.refused,
    );
    expect(h.out).toEqual([]);
    expect(h.err.join("")).toContain("Refused");
  });

  it("redacts URLs quoted in scanner errors", async () => {
    const h = harness(async () => {
      throw new Error(
        "net::ERR_FAILED at https://example.com/a/b?token=SECRET123&id=7",
      );
    });
    expect(await runCli(["scan", "https://example.com"], h.io)).toBe(
      EXIT.failed,
    );
    const text = h.err.join("");
    expect(text).not.toMatch(/SECRET123|token=|\/a\/b/);
    expect(text).toContain("https://example.com");
  });

  it("explains a missing browser install", async () => {
    const h = harness(async () => {
      throw new Error(
        "browserType.launch: Executable doesn't exist at /somewhere",
      );
    });
    expect(await runCli(["scan", "https://example.com"], h.io)).toBe(
      EXIT.failed,
    );
    expect(h.err.join("")).toContain("npx playwright install chromium");
  });

  it("does not write a file when the scan fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pl-cli-"));
    dirs.push(dir);
    const file = join(dir, "never.json");
    const h = harness(async () => {
      throw new Error("boom");
    });
    await runCli(["scan", "https://example.com", "-o", file], h.io);
    expect(existsSync(file)).toBe(false);
  });
});

describe("cli process", () => {
  let sandbox = true;
  beforeAll(async () => {
    sandbox = await sandboxAvailable();
  }, 30_000);
  // Only where the host cannot start the sandbox does the test say so explicitly.
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "src/cli/privacylens.ts",
        ...args,
        ...(args[0] === "scan" && !sandbox ? ["--unsafe-no-sandbox"] : []),
      ],
      { encoding: "utf8", timeout: 60_000 },
    );

  it("starts as a real process and reports its version", () => {
    const result = run("--version");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("refuses a private target with exit 3, empty stdout and no path or query in stderr", () => {
    const result = run(
      "scan",
      "http://127.0.0.1:8081/internal/path?token=SECRET123",
    );
    expect(result.status).toBe(EXIT.refused);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toMatch(/SECRET123|token=|\/internal\/path/);
  }, 70_000);
});

describe("cli terminal safety and validation", () => {
  it("strips escape sequences and other control characters from anything it prints", () => {
    const hostile =
      "\u001b[2J\u001b]0;pwned\u0007 line\nReport written to /tmp/ok.json \u202e evil \u0085 \u200b";
    const out = plain(hostile);
    for (const code of [0x1b, 0x07, 0x0a, 0x85, 0x202e, 0x200b])
      expect(
        out.includes(String.fromCodePoint(code)),
        `U+${code.toString(16)}`,
      ).toBe(false);
    expect(plain("x".repeat(1000)).length).toBeLessThanOrEqual(403);
  });

  it("never lets scanner error text inject terminal sequences or forge lines", async () => {
    const h = harness(async () => {
      throw new Error(
        "boom \u001b[2J\u001b]0;pwned\u0007\nReport written to /tmp/ok.json",
      );
    });
    expect(await runCli(["scan", "https://example.com"], h.io)).toBe(
      EXIT.failed,
    );
    const text = h.err.join("");
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\u0007");
    // One progress line plus one error line: the forged line did not become its own line.
    expect(text.trim().split("\n")).toHaveLength(2);
  });

  it("reports a limit stop as stopped, not as a generic failure", async () => {
    const h = harness(async () => {
      throw new ScanLimitError(
        "The page used more memory than the scan allows, so the scan was stopped",
      );
    });
    expect(await runCli(["scan", "https://example.com"], h.io)).toBe(
      EXIT.failed,
    );
    expect(h.err.join("")).toContain("Stopped: The page used more memory");
  });

  it.each([
    [["scan", "https://example.com", "--timeout", "5", "--settle", "4"]],
    [["scan", "https://example.com", "--timeout", "10", "--settle", "9"]],
    [["scan", "https://example.com", "--out", ""]],
    [["scan", "https://example.com", "--out", "  "]],
  ])("rejects %j as a usage error without scanning", async (argv) => {
    let scanned = false;
    const h = harness(async () => {
      scanned = true;
      return SAMPLE_REPORT;
    });
    expect(await runCli(argv, h.io)).toBe(EXIT.usage);
    expect(scanned).toBe(false);
  });

  it("keeps the browser sandbox on unless explicitly told otherwise", async () => {
    const seen: Array<boolean | undefined> = [];
    const h = harness(async (_url, options) => {
      seen.push(options?.chromiumSandbox);
      return SAMPLE_REPORT;
    });
    await runCli(["scan", "https://example.com"], h.io);
    const unsafe = harness(async (_url, options) => {
      seen.push(options?.chromiumSandbox);
      return SAMPLE_REPORT;
    });
    await runCli(
      ["scan", "https://example.com", "--unsafe-no-sandbox"],
      unsafe.io,
    );
    expect(seen).toEqual([true, false]);
    expect(h.err.join("")).not.toMatch(/sandbox is disabled/);
    expect(unsafe.err.join("")).toMatch(/sandbox is disabled/);
  });

  it("does not claim Chromium is missing for unrelated launch errors", async () => {
    const h = harness(async () => {
      throw new Error("browserType.launch: Target page crashed");
    });
    await runCli(["scan", "https://example.com"], h.io);
    expect(h.err.join("")).not.toContain("npx playwright install");
  });
});
