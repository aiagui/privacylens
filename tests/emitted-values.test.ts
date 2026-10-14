import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { validateReport } from "../src/report/validate";
import { SAMPLE_REPORT } from "../src/sample-report";
import { toCookieFindings } from "../src/scanner/collector-common";
import {
  startEgressProxy,
  type EgressProxy,
} from "../src/scanner/egress-proxy";
import { capCookies, elapsedMs, isRecordable } from "../src/scanner/scan-live";

/**
 * Everything the scanner can emit must fit the report format. These tests drive
 * the scanner's own helpers and the proxy with awkward values and then push the
 * results through the validator, so a narrowed rule or a new emitter fails here.
 */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function withEgress(
  blockedDestinations: Array<{ host: string; port: number; reason: string }>,
) {
  const report = clone(SAMPLE_REPORT);
  report.provenance = {
    mode: "local-cli",
    scanner: { name: "privacylens", version: "0.1.0" },
    browser: { name: "chromium", version: "156.0.8078.4", sandbox: true },
    requestedOrigin: "https://sample-shop.example",
    finalOrigin: "https://sample-shop.example",
    durationMs: 1,
    settleMs: 1,
    timeoutMs: 1,
    droppedRequests: 0,
    egress: {
      allowedConnections: 0,
      blockedConnections: blockedDestinations.length,
      limitRefusals: 0,
      failedConnections: 0,
      blockedDestinationsTruncated: false,
      blockedDestinations,
    },
  };
  return report;
}

let proxy: EgressProxy | undefined;
afterEach(async () => {
  await proxy?.close();
  proxy = undefined;
});

function sendRaw(p: EgressProxy, request: string): Promise<void> {
  return new Promise((done) => {
    const socket = connect(p.port, "127.0.0.1");
    socket.on("close", () => done());
    socket.on("error", () => done());
    socket.write(request);
    setTimeout(() => socket.destroy(), 800);
  });
}

describe("blocked destinations the proxy can record always fit the format", () => {
  const auth = (p: EgressProxy) =>
    `Basic ${Buffer.from(`${p.credentials.username}:${p.credentials.password}`).toString("base64")}`;

  // [description, authority, whether Node's HTTP parser lets it through to the proxy]
  it.each([
    ["a malformed authority", "x.example:0", true],
    ["no host at all", ":443", true],
    [
      "a percent-encoded host, as Chromium writes '*'",
      "a%2ab.example:443",
      true,
    ],
    ["a very long host", `${"a".repeat(400)}.example:443`, true],
    // The HTTP parser itself refuses these bytes in a request line, so they can
    // never be recorded; if that ever changed, they must still fit the format.
    ["a host with quotes and braces", 'a"b{c}.example:443', false],
    ["a host with non-ASCII bytes", "caf\u00e9.example:443", false],
  ])("%s", async (_name, authority, reachesProxy) => {
    proxy = await startEgressProxy({
      policy: { allowAddress: () => false },
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    await sendRaw(
      proxy,
      `CONNECT ${authority} HTTP/1.1\r\nHost: x\r\nProxy-Authorization: ${auth(proxy)}\r\n\r\n`,
    );
    const { blockedDestinations } = proxy.stats();
    if (reachesProxy) expect(blockedDestinations.length).toBeGreaterThan(0);
    for (const entry of blockedDestinations)
      expect(entry.host.length).toBeLessThanOrEqual(253);
    const result = validateReport(withEgress(blockedDestinations));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
  });

  it("records a request too malformed to name a host under a placeholder", async () => {
    proxy = await startEgressProxy();
    await sendRaw(
      proxy,
      `CONNECT :80 HTTP/1.1\r\nHost: x\r\nProxy-Authorization: ${auth(proxy)}\r\n\r\n`,
    );
    expect(proxy.stats().blockedDestinations[0]?.host).toBe("(malformed)");
  });
});

describe("cookies the scanner can emit always fit the format", () => {
  const cookie = (
    over: Partial<Parameters<typeof toCookieFindings>[0][number]> = {},
  ) => ({
    name: "a",
    domain: ".site.example",
    expires: 1,
    secure: true,
    httpOnly: false,
    sameSite: "Lax",
    ...over,
  });

  it("clamps a far-future expiry to year 9999 instead of an unrepresentable date", () => {
    for (const expires of [
      253_402_300_799,
      253_402_300_800,
      1e12,
      1e15,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const [finding] = toCookieFindings([cookie({ expires })], "site.example");
      expect(finding?.expires, String(expires)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(finding!.expires!.startsWith("9999-")).toBe(true);
      const report = clone(SAMPLE_REPORT);
      report.cookies = [finding!];
      expect(validateReport(report).ok, String(expires)).toBe(true);
    }
  });

  it("omits expiry for a session cookie", () => {
    expect(
      toCookieFindings([cookie({ expires: -1 })], "site.example")[0],
    ).not.toHaveProperty("expires");
  });

  it("keeps the list within the format's bound and says how many were left out", () => {
    const { kept, hidden } = capCookies(
      Array.from({ length: 2700 }, (_, i) => i),
    );
    expect(kept).toHaveLength(2000);
    expect(hidden).toBe(700);
    expect(capCookies([1, 2, 3])).toEqual({ kept: [1, 2, 3], hidden: 0 });
    const report = clone(SAMPLE_REPORT);
    report.cookies = Array.from({ length: kept.length }, (_, i) => ({
      name: `c${i}`,
      domain: "site.example",
      firstParty: true,
      secure: true,
      httpOnly: false,
    }));
    expect(validateReport(report).ok).toBe(true);
  });
});

describe("requests and times the scanner can emit always fit the format", () => {
  it("does not record a host the format cannot hold", () => {
    expect(isRecordable(new URL("https://example.com/"))).toBe(true);
    expect(isRecordable(new URL(`https://${"a".repeat(253)}/`))).toBe(true);
    expect(isRecordable(new URL(`https://${"a".repeat(254)}/`))).toBe(false);
    expect(isRecordable(new URL(`http://${"a".repeat(400)}.example/`))).toBe(
      false,
    );
  });

  it("never reports a negative time, even if the clock steps backwards", () => {
    expect(elapsedMs(1500, 1000)).toBe(500);
    expect(elapsedMs(1000, 1000)).toBe(0);
    expect(elapsedMs(900, 1000)).toBe(0);
  });
});
