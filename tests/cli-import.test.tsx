import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT, runCli } from "../src/cli/privacylens";
import { ReportView } from "../src/components/report-view";
import { MAX_REPORT_BYTES, parseReportText } from "../src/report/import";
import { scanLive } from "../src/scanner/scan-live";
import { REPORT_SCHEMA_VERSION } from "../src/scanner/types";
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

beforeAll(async () => {
  sandbox = await resolveSandbox("tests/cli-import.test.tsx");
  dir = mkdtempSync(join(tmpdir(), "pl-import-"));
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
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
});
