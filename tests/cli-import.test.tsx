import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT, runCli } from "../src/cli/privacylens";
import { ReportView } from "../src/components/report-view";
import { MAX_REPORT_BYTES, parseReportText } from "../src/report/import";
import { hasUnsafeCharacter } from "../src/report/text";
import { scanLive } from "../src/scanner/scan-live";
import { REPORT_SCHEMA_VERSION, type ScanReport } from "../src/scanner/types";
import { resolveSandbox } from "./helpers/sandbox";

/**
 * The report is produced by the real CLI code path (runCli -> scanLive ->
 * JSON file) against a local fixture with real Chromium. Only the egress policy
 * is injected, because the CLI itself refuses loopback targets by design.
 */
let server: Server;
let port = 0;
let sandbox = true;
let dir = "";

/** Paths of any key whose value is undefined: JSON would silently drop them. */
function undefinedPaths(value: unknown, path = "report"): string[] {
  if (value === undefined) return [path];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    undefinedPaths(child, `${path}.${key}`),
  );
}

beforeAll(async () => {
  sandbox = await resolveSandbox("tests/cli-import.test.tsx");
  dir = mkdtempSync(join(tmpdir(), "pl-import-"));
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/everything") {
      // Every awkward but legitimate thing a real site can do, in one page.
      res.writeHead(200, {
        "content-type": "text/html",
        // A cookie with no name: Chromium reports it as an empty name.
        "set-cookie": ["justvalue; Path=/", "visit_count=3; Path=/"],
      });
      return void res.end(`<!doctype html><title>Everything</title>
        <script>
          document.cookie = "a\u200bb=1; Path=/";
          document.cookie = "\u202eevil=1; Path=/";
          try { new WebSocket("ws://chat.example:${port}/sock"); } catch {}
          fetch("http://my_cdn.example:${port}/x", { mode: "no-cors" }).catch(() => {});
          // Hosts Node and Chromium accept but DNS would not: quote, backtick,
          // braces, a very long name, and a "*" (Chromium writes it as %2a).
          for (const code of [34, 96, 123, 125])
            fetch("http://a" + String.fromCharCode(code) + "b.example:${port}/x", { mode: "no-cors" }).catch(() => {});
          fetch("http://" + "l".repeat(400) + ".example:${port}/x", { mode: "no-cors" }).catch(() => {});
          fetch("https://a*b.example/x", { mode: "no-cors" }).catch(() => {});
          for (let i = 0; i < 130; i++)
            fetch("http://s" + i + ".google-analytics.com:${port}/g/collect?v=2", { mode: "no-cors" }).catch(() => {});
        </script>`);
    }
    if (path === "/matomo.php")
      return void res
        .writeHead(204, { "access-control-allow-origin": "*" })
        .end();
    res.writeHead(200, {
      "content-type": "text/html",
      "set-cookie": "visit_count=3; Path=/; SameSite=Lax",
    });
    res.end(`<!doctype html><title>Fixture</title><div id="onetrust-banner-sdk">c</div>
      <script>
        fetch("http://stats.example:${port}/matomo.php?idsite=1&uid=private", { mode: "no-cors" }).catch(() => {});
        fetch("http://cdn.example:${port}/lib.js").catch(() => {});
        fetch("http://127.0.0.1:8081/internal").catch(() => {});
      </script>`);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

describe("a report written by the real CLI can be imported and displayed", () => {
  it("round-trips through --out, validation and rendering", async () => {
    const out = join(dir, "report.json");
    const err: string[] = [];
    const code = await runCli(
      ["scan", `http://site.example:${port}/`, "--out", out, "--settle", "1"],
      {
        stdout: () => undefined,
        stderr: (t) => err.push(t),
        version: "0.1.0",
        scan: (target, options) =>
          scanLive(target, {
            ...options,
            chromiumSandbox: sandbox,
            egress: {
              policy: {
                allowAddress: (a, p) => a === "127.0.0.1" && p === port,
              },
              resolve: async () => [{ address: "127.0.0.1", family: 4 }],
            },
          }),
      },
    );
    expect(code, err.join("")).toBe(EXIT.ok);
    expect(err.join("")).not.toMatch(/Warning/);

    const content = readFileSync(out, "utf8");
    expect(statSync(out).size).toBeLessThan(MAX_REPORT_BYTES);
    expect(JSON.parse(content).schemaVersion).toBe(REPORT_SCHEMA_VERSION);

    const imported = parseReportText(content);
    if (!imported.ok) throw new Error(JSON.stringify(imported.issues));
    const { report } = imported;

    // Evidence and classifications survive the trip unchanged.
    expect(report.technologies.find((t) => t.name === "Matomo")).toMatchObject({
      observation: "observed",
      signature: { id: "matomo" },
    });
    expect(report.thirdPartyRequests.map((r) => r.classification)).toEqual(
      expect.arrayContaining(["observed", "unknown"]),
    );
    expect(
      report.thirdPartyRequests.some((r) => r.outcome === "completed"),
    ).toBe(true);
    expect(report.cmp).toMatchObject({ detected: true, name: "OneTrust" });
    expect(report.provenance).toMatchObject({
      mode: "local-cli",
      scanner: { version: "0.1.0" },
      browser: { name: "chromium", sandbox },
    });
    expect(report.provenance?.egress.blockedConnections).toBeGreaterThan(0);
    // The privacy rules hold in the file the user would share.
    expect(content).not.toContain("uid=");
    expect(content).not.toContain("visit_count=3");
    expect(content).not.toMatch(/matomo\.php|idsite/);

    // And it displays through the real components.
    const html = renderToStaticMarkup(<ReportView report={report} imported />);
    expect(html).toContain("Imported report.");
    expect(html).toContain("Matomo");
    for (const label of ["OBSERVED", "UNKNOWN"]) expect(html).toContain(label);
    expect(html).toContain("How this report was collected");
    expect(html).toContain(sandbox ? "On" : "Off: this scan ran without");
  }, 60_000);

  it("is rejected if someone edits the file to another schema version", async () => {
    const out = join(dir, "report2.json");
    await runCli(
      ["scan", `http://site.example:${port}/`, "--out", out, "--settle", "1"],
      {
        stdout: () => undefined,
        stderr: () => undefined,
        scan: (target, options) =>
          scanLive(target, {
            ...options,
            chromiumSandbox: sandbox,
            egress: {
              policy: {
                allowAddress: (a, p) => a === "127.0.0.1" && p === port,
              },
              resolve: async () => [{ address: "127.0.0.1", family: 4 }],
            },
          }),
      },
    );
    const edited = readFileSync(out, "utf8").replace(
      '"schemaVersion": 1',
      '"schemaVersion": 2',
    );
    const result = parseReportText(edited);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues[0]?.message).toMatch(/newer than the version 1/);
  }, 60_000);

  it("imports the report from a page that does every awkward thing a real site can", async () => {
    const out = join(dir, "everything.json");
    const err: string[] = [];
    let captured: ScanReport | undefined;
    const code = await runCli(
      [
        "scan",
        `http://site.example:${port}/everything`,
        "--out",
        out,
        "--settle",
        "2",
      ],
      {
        stdout: () => undefined,
        stderr: (t) => err.push(t),
        version: "0.1.0",
        scan: async (target, options) => {
          const scanned = await scanLive(target, {
            ...options,
            chromiumSandbox: sandbox,
            egress: {
              policy: {
                allowAddress: (a, p) => a === "127.0.0.1" && p === port,
              },
              resolve: async () => [{ address: "127.0.0.1", family: 4 }],
            },
          });
          captured = scanned;
          return scanned;
        },
      },
    );
    expect(code, err.join("")).toBe(EXIT.ok);
    // The CLI's own check of the written file must not cry wolf on a real scan.
    expect(err.join("")).not.toMatch(/Warning/);
    // And the scanner never leaves an undefined-valued key: JSON would silently
    // drop it, and the in-memory report would differ from the written one.
    expect(undefinedPaths(captured)).toEqual([]);
    const content = readFileSync(out, "utf8");
    const imported = parseReportText(content);
    // The regression guard: whatever the scanner can emit must import.
    if (!imported.ok) throw new Error(JSON.stringify(imported.issues));
    const { report } = imported;

    // A WebSocket origin, an underscore host and a nameless cookie are all present.
    expect(
      report.thirdPartyRequests.some((r) => r.url.startsWith("ws://")),
    ).toBe(true);
    expect(
      report.thirdPartyRequests.some((r) => r.domain === "my_cdn.example"),
    ).toBe(true);
    expect(report.cookies.some((c) => c.name === "[unnamed]")).toBe(true);
    expect(report.cookies.some((c) => c.name === "visit_count")).toBe(true);
    // Chromium hands back non-ASCII cookie names garbled, so the hostile name
    // arrives as ordinary text. Either way no unsafe character may reach the file.
    expect(hasUnsafeCharacter(content.replaceAll("\n", ""))).toBe(false);
    // Awkward hosts are recorded as the browser wrote them, or not listed at all.
    expect(report.thirdPartyRequests.some((r) => /[{}"`]/.test(r.domain))).toBe(
      true,
    );
    expect(report.thirdPartyRequests.every((r) => r.domain.length <= 253)).toBe(
      true,
    );
    expect(report.provenance?.droppedRequests).toBeGreaterThan(0);
    expect(
      report.provenance?.egress.blockedDestinations.some((d) =>
        d.host.includes("%"),
      ),
    ).toBe(true);
    // A page cannot flood a technology's evidence past its bound.
    const analytics = report.technologies.find(
      (t) => t.name === "Google Analytics",
    );
    expect(analytics).toBeDefined();
    expect(analytics!.evidence.length).toBeLessThanOrEqual(51);
  }, 90_000);
});
