import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chromium } from "playwright";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  browserTree,
  listProcesses,
  treeOf,
} from "../src/scanner/browser-process";
import { scanLive } from "../src/scanner/scan-live";
import { SANDBOX_REQUIRED, resolveSandbox } from "./helpers/sandbox";

/**
 * Chromium's process sandbox.
 *
 * Two kinds of test live here, and the difference matters:
 *  - "fail closed" tests mock the browser launch, run everywhere, and prove the
 *    scanner asks for the sandbox by default and never silently falls back.
 *  - "real sandbox" tests need a machine where Chromium's sandbox can start
 *    (on Linux: unprivileged user namespaces, see docs/ci-and-releases.md).
 *    The "Chromium sandbox tests" CI job sets PRIVACYLENS_REQUIRE_SANDBOX=1, which
 *    turns "cannot start" into a failure. Elsewhere they are reported as skipped.
 */

let server: Server;
let port = 0;
let sandboxOK = false;

const egress = () => ({
  policy: {
    allowAddress: (address: string, p: number) =>
      address === "127.0.0.1" && p === port,
  },
  resolve: async () => [{ address: "127.0.0.1", family: 4 }],
});

beforeAll(async () => {
  sandboxOK = await resolveSandbox("tests/sandbox.test.ts");
  server = createServer((_req, res) => {
    res
      .writeHead(200, { "content-type": "text/html" })
      .end("<!doctype html><p>ok</p>");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fail closed (mocked launch, runs everywhere)", () => {
  it("asks Chromium for its sandbox by default", async () => {
    const launch = vi
      .spyOn(chromium, "launch")
      .mockRejectedValue(new Error("stop here"));
    await expect(
      scanLive(`http://site.example:${port}/`, {
        egress: egress(),
        settleMs: 500,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow("stop here");
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0]?.[0]).toMatchObject({ chromiumSandbox: true });
  });

  it("only turns the sandbox off when explicitly told to", async () => {
    const launch = vi
      .spyOn(chromium, "launch")
      .mockRejectedValue(new Error("stop here"));
    await scanLive(`http://site.example:${port}/`, {
      egress: egress(),
      settleMs: 500,
      timeoutMs: 10_000,
      chromiumSandbox: false,
    }).catch(() => undefined);
    expect(launch.mock.calls[0]?.[0]).toMatchObject({ chromiumSandbox: false });
  });

  it.each([
    "Failed to launch: No usable sandbox! Update your kernel or see the docs",
    "Running as root without --no-sandbox is not supported",
    "Creating a new user namespace failed: Operation not permitted",
    "zygote could not fork",
  ])(
    "fails with guidance, and never retries without the sandbox, when it cannot start (%s)",
    async (message) => {
      const launch = vi
        .spyOn(chromium, "launch")
        .mockRejectedValue(new Error(message));
      const error = await scanLive(`http://site.example:${port}/`, {
        egress: egress(),
        settleMs: 500,
        timeoutMs: 10_000,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/sandbox could not start/);
      expect((error as Error).message).toMatch(/--unsafe-no-sandbox/);
      // Exactly one attempt, with the sandbox requested: no silent downgrade.
      expect(launch).toHaveBeenCalledTimes(1);
      expect(launch.mock.calls[0]?.[0]).toMatchObject({
        chromiumSandbox: true,
      });
    },
  );

  it("does not offer the escape hatch for unrelated launch errors", async () => {
    vi.spyOn(chromium, "launch").mockRejectedValue(
      new Error("Executable doesn't exist at /x"),
    );
    const error = await scanLive(`http://site.example:${port}/`, {
      egress: egress(),
      settleMs: 500,
      timeoutMs: 10_000,
    }).catch((e: unknown) => e);
    expect((error as Error).message).not.toMatch(/--unsafe-no-sandbox/);
  });

  it("says so in the report when the sandbox was switched off", async () => {
    const report = await scanLive(`http://site.example:${port}/`, {
      egress: egress(),
      settleMs: 500,
      timeoutMs: 20_000,
      chromiumSandbox: false,
    });
    expect(report.provenance?.browser.sandbox).toBe(false);
    expect(report.limitations.join(" ")).toMatch(/sandbox was disabled/);
  }, 30_000);
});

describe("real sandbox (needs a host that can start it)", () => {
  /** Skips visibly, never as a pass, and never at all where the sandbox is required. */
  const guard = (context: { skip: () => void }) => {
    if (sandboxOK) return false;
    expect(
      SANDBOX_REQUIRED,
      "the sandbox is required here but cannot start",
    ).toBe(false);
    context.skip();
    return true;
  };

  it("passes --no-sandbox to no Chromium process when the sandbox is on", async (context) => {
    if (guard(context)) return;
    const run = async (sandbox: boolean) => {
      const marker = `privacylens-run-test-${Math.random().toString(16).slice(2)}`;
      const browser = await chromium.launch({
        headless: true,
        chromiumSandbox: sandbox,
        args: [`--privacylens-run=${marker}`],
      });
      try {
        await (await browser.newPage()).goto("about:blank");
        return (await browserTree(marker)).map((proc) => proc.args);
      } finally {
        await browser.close();
      }
    };
    const withSandbox = await run(true);
    expect(withSandbox.length).toBeGreaterThan(1);
    expect(withSandbox.some((args) => args.includes("--no-sandbox"))).toBe(
      false,
    );
    // Control: Playwright adds the flag when the sandbox is off, so the check above can fail.
    expect(
      (await run(false)).some((args) => args.includes("--no-sandbox")),
    ).toBe(true);
  }, 40_000);

  it("runs scanLive's own browser with the sandbox on, observed while it runs", async (context) => {
    if (guard(context)) return;
    const scanning = scanLive(`http://site.example:${port}/`, {
      egress: egress(),
      settleMs: 3_500,
      timeoutMs: 30_000,
    });
    await new Promise((done) => setTimeout(done, 2_000));
    const tree = treeOf(
      "--privacylens-run=privacylens-run-",
      await listProcesses(),
      // Only real browser binaries: a shell whose command line merely mentions
      // the marker must not count.
    ).filter((proc) => /^\/\S*(?:chrom|headless)/i.test(proc.args));
    const report = await scanning;
    // Several processes (browser, renderer, network service...) and none unsandboxed.
    expect(tree.length).toBeGreaterThan(1);
    expect(tree.filter((proc) => proc.args.includes("--no-sandbox"))).toEqual(
      [],
    );
    expect(report.provenance?.browser.sandbox).toBe(true);
    expect(report.limitations.join(" ")).not.toMatch(/sandbox was disabled/);
  }, 45_000);

  it("the production CLI starts with the sandbox and without the escape hatch", async (context) => {
    if (guard(context)) return;
    const result = spawnSync(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "src/cli/privacylens.ts",
        "scan",
        "http://127.0.0.1:8081/",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    // Refused for its address (exit 3): the browser launched fine with the sandbox.
    expect(result.status).toBe(3);
    expect(result.stderr).not.toMatch(/sandbox is disabled|could not start/);
  }, 70_000);
});
