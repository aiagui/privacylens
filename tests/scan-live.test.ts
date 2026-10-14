import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanLive, parseTargetUrl, redactUrls } from "../src/scanner/scan-live";
import { UnsafeTargetError } from "../src/scanner/url-policy";
import type { EgressOptions } from "../src/scanner/egress-proxy";

/**
 * "Public" site and "internal" server both live on loopback in this test. A
 * test-only policy lets the filter reach ONLY the public fixture's port, and a
 * resolver maps invented names to loopback. The default policy is exercised
 * separately below. The internal server counts raw TCP connections, which is
 * stricter than counting HTTP requests.
 */
let publicServer: Server;
let internalServer: Server;
let publicPort = 0;
let internalPort = 0;
let internalConnections = 0;
let internalRequests = 0;

const NAMES = [
  "site.example",
  "cdn.example",
  "internal.example",
  "www.google-analytics.com",
  "www.googletagmanager.com",
  "metadata.example",
  "stats.example",
];

function egress(): EgressOptions {
  return {
    policy: {
      allowAddress: (address, port) =>
        address === "127.0.0.1" && port === publicPort,
    },
    resolve: async (host) =>
      NAMES.includes(host) || host === "127.0.0.1"
        ? [{ address: "127.0.0.1", family: 4 }]
        : Promise.reject(new Error("ENOTFOUND")),
  };
}

function page(body: string) {
  return `<!doctype html><title>fixture</title><div id="onetrust-banner-sdk">c</div>${body}`;
}

beforeAll(async () => {
  internalServer = createServer((_req, res) => {
    internalRequests += 1;
    res.end("internal-secret");
  });
  internalServer.on("connection", () => {
    internalConnections += 1;
  });
  await new Promise<void>((done) =>
    internalServer.listen(0, "127.0.0.1", done),
  );
  internalPort = (internalServer.address() as { port: number }).port;

  publicServer = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/redirect-internal") {
      res
        .writeHead(302, { Location: `http://127.0.0.1:${internalPort}/x` })
        .end();
    } else if (path === "/redirect-name") {
      res
        .writeHead(302, {
          Location: `http://internal.example:${internalPort}/x`,
        })
        .end();
    } else if (path === "/asset-redirect") {
      res
        .writeHead(302, { Location: `http://127.0.0.1:${internalPort}/asset` })
        .end();
    } else if (path === "/hostile") {
      res.writeHead(200, {
        "content-type": "text/html",
        "set-cookie": "session_token=supersecretvalue; Path=/; HttpOnly",
      });
      res.end(
        page(`<script>
          const internal = "http://127.0.0.1:${internalPort}";
          const named = "http://internal.example:${internalPort}";
          fetch(internal + "/fetch").catch(() => {});
          fetch(named + "/named").catch(() => {});
          fetch("http://[::1]:${internalPort}/v6").catch(() => {});
          fetch("http://169.254.169.254/latest/meta-data/").catch(() => {});
          fetch("http://metadata.example:80/").catch(() => {});
          fetch("http://cdn.example:${publicPort}/asset-redirect").catch(() => {});
          new Image().src = internal + "/img";
          try { new WebSocket("ws://127.0.0.1:${internalPort}/ws"); } catch {}
          try { navigator.sendBeacon(internal + "/beacon", "x"); } catch {}
          const frame = document.createElement("iframe");
          frame.src = named + "/frame";
          document.body.appendChild(frame);
          const form = document.createElement("form");
          form.method = "POST"; form.action = internal + "/form";
          fetch("http://cdn.example:${publicPort}/ok?token=ABC123&email=a@b.c").catch(() => {});
        </script>`),
      );
    } else if (path === "/trackers") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page(`<script src="http://www.googletagmanager.com:${publicPort}/gtag/js?id=G-SECRETID"></script>
          <script>
            fetch("http://www.google-analytics.com:${publicPort}/g/collect?v=2&cid=private-client-id", { mode: "no-cors" }).catch(() => {});
            fetch("http://stats.example:${publicPort}/matomo.php?idsite=1&uid=private-client-id", { mode: "no-cors" }).catch(() => {});
            fetch("http://cdn.example:${publicPort}/lib.js?user=someone").catch(() => {});
          </script>`),
      );
    } else if (path === "/nocors/matomo.php") {
      // Reaches the server but sends no CORS header, so the browser blocks the read.
      res.writeHead(204).end();
    } else if (path === "/matomo.php" || path.endsWith("/collect")) {
      // Real collection endpoints answer with an empty 204, not a page.
      res.writeHead(204, { "access-control-allow-origin": "*" }).end();
    } else if (path === "/cors") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page(
          `<script>fetch("http://stats.example:${publicPort}/nocors/matomo.php").catch(() => {});</script>`,
        ),
      );
    } else if (path === "/missing") {
      res.writeHead(404).end("nope");
    } else {
      res
        .writeHead(200, { "content-type": "text/html" })
        .end(page("<p>hello</p>"));
    }
  });
  await new Promise<void>((done) => publicServer.listen(0, "127.0.0.1", done));
  publicPort = (publicServer.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise((done) => publicServer.close(done));
  await new Promise((done) => internalServer.close(done));
});

const options = () => ({ egress: egress(), settleMs: 800, timeoutMs: 25_000 });

describe("scanLive default egress policy", () => {
  it("refuses a loopback target without contacting it", async () => {
    let hits = 0;
    const probe = createServer((_q, r) => {
      hits += 1;
      r.end("x");
    });
    probe.on("connection", () => {
      hits += 1;
    });
    await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
    const port = (probe.address() as { port: number }).port;
    await expect(
      scanLive(`http://127.0.0.1:${port}/`, { timeoutMs: 15_000 }),
    ).rejects.toBeInstanceOf(UnsafeTargetError);
    await expect(
      scanLive(`http://localhost:${port}/`, { timeoutMs: 15_000 }),
    ).rejects.toBeInstanceOf(UnsafeTargetError);
    await new Promise((done) => probe.close(done));
    expect(hits).toBe(0);
  }, 40_000);

  it("reports an unresolvable name as a failure, not as a safety refusal", async () => {
    const error = await scanLive("http://no-such-host.invalid/", {
      timeoutMs: 15_000,
      egress: { resolve: async () => Promise.reject(new Error("ENOTFOUND")) },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnsafeTargetError);
    expect((error as Error).message).toMatch(/could not be resolved/);
  }, 25_000);

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]:8081/",
    "http://[::ffff:7f00:1]:8081/",
    "http://10.0.0.1/",
  ])(
    "refuses private target %s",
    async (target) => {
      await expect(
        scanLive(target, { timeoutMs: 15_000 }),
      ).rejects.toBeInstanceOf(UnsafeTargetError);
    },
    25_000,
  );
});

describe("scanLive adversarial page", () => {
  it("cannot reach an internal server by fetch, image, frame, beacon, WebSocket or redirect", async () => {
    internalConnections = 0;
    internalRequests = 0;
    const report = await scanLive(
      `http://site.example:${publicPort}/hostile`,
      options(),
    );

    expect(internalConnections).toBe(0);
    expect(internalRequests).toBe(0);
    expect(report.provenance?.egress.blockedConnections).toBeGreaterThan(0);
    const blocked = report.thirdPartyRequests.filter(
      (r) => r.outcome === "blocked",
    );
    expect(blocked.length).toBeGreaterThan(0);
    for (const request of blocked) {
      // A refused request is not evidence about its destination.
      expect(request.technology).toBeUndefined();
      expect(request.classification).toBe("unknown");
    }
    expect(report.limitations.join(" ")).toMatch(
      /refused by the egress filter/,
    );
  }, 40_000);

  it("blocks a top-level redirect into the internal network", async () => {
    internalConnections = 0;
    for (const path of ["/redirect-internal", "/redirect-name"]) {
      await expect(
        scanLive(`http://site.example:${publicPort}${path}`, options()),
      ).rejects.toThrow();
    }
    expect(internalConnections).toBe(0);
  }, 40_000);

  it("never records values, paths or queries", async () => {
    const report = await scanLive(
      `http://site.example:${publicPort}/hostile`,
      options(),
    );
    const text = JSON.stringify(report);
    for (const secret of [
      "supersecretvalue",
      "ABC123",
      "a@b.c",
      "/ok",
      "/latest/meta-data",
      "token=",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(report.targetUrl).toBe(`http://site.example:${publicPort}`);
    expect(report.cookies.map((c) => c.name)).toContain("[REDACTED]");
  }, 30_000);
});

describe("scanLive evidence", () => {
  it("records recognized trackers with signature, outcome and provenance", async () => {
    const report = await scanLive(
      `http://site.example:${publicPort}/trackers`,
      options(),
    );
    const analytics = report.technologies.find(
      (t) => t.name === "Google Analytics",
    );
    expect(analytics).toMatchObject({
      observation: "observed",
      signature: { id: "google-analytics" },
    });
    const matomo = report.technologies.find((t) => t.name === "Matomo");
    expect(matomo).toMatchObject({ observation: "observed" });
    expect(matomo?.evidence.join(" ")).toMatch(
      /Outcome: completed \(HTTP 204\)/,
    );
    const manager = report.technologies.find(
      (t) => t.name === "Google Tag Manager",
    );
    expect(manager?.observation).toBe("inferred");
    expect(report.concerns.map((c) => c.title)).toContain(
      "Tracking before interaction",
    );
    expect(report.cmp).toMatchObject({ detected: true, name: "OneTrust" });
    const unknown = report.thirdPartyRequests.find(
      (r) => r.domain === "cdn.example",
    );
    expect(unknown?.classification).toBe("unknown");
    expect(report.signatureSetVersion).toBeTruthy();
    expect(report.provenance).toMatchObject({
      mode: "local-cli",
      browser: { name: "chromium" },
      requestedOrigin: `http://site.example:${publicPort}`,
    });
    expect(JSON.stringify(report)).not.toContain("private-client-id");
    expect(JSON.stringify(report)).not.toContain("G-SECRETID");
  }, 30_000);

  it("labels a CORS-blocked cross-origin fetch as failed without claiming it never arrived", async () => {
    const report = await scanLive(
      `http://site.example:${publicPort}/cors`,
      options(),
    );
    const evidence = report.technologies
      .find((t) => t.name === "Matomo")
      ?.evidence.join(" ");
    expect(evidence).toMatch(/reported the request as failed/);
    expect(evidence).toMatch(/may still have reached the server/);
  }, 30_000);

  it("does not produce a report for a non-success page", async () => {
    await expect(
      scanLive(`http://site.example:${publicPort}/missing`, options()),
    ).rejects.toThrow(/HTTP status 404/);
  }, 30_000);
});

describe("target parsing and error redaction", () => {
  it.each([
    "ftp://example.com/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://user:pass@example.com/",
    "not a url",
    "",
    `https://example.com/${"a".repeat(3000)}`,
  ])("rejects %j", (input) => {
    expect(() => parseTargetUrl(input)).toThrow(UnsafeTargetError);
  });

  it("drops the fragment and keeps an https origin", () => {
    expect(parseTargetUrl("https://example.com/a?b=c#frag").hash).toBe("");
  });

  it("reduces URLs quoted in error text to their origin", () => {
    expect(
      redactUrls(
        "net::ERR at https://example.com/secret/path?token=abc123 failed",
      ),
    ).toBe("net::ERR at https://example.com failed");
    expect(redactUrls("see blob:https://a.test/some-uuid now")).not.toContain(
      "some-uuid",
    );
  });
});
