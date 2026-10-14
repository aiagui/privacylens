import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BROWSER_ARGS,
  ScanLimitError,
  scanLive,
  parseTargetUrl,
  redactUrls,
} from "../src/scanner/scan-live";
import { UnsafeTargetError } from "../src/scanner/url-policy";
import { browserTree, listProcesses } from "../src/scanner/browser-process";
import { sandboxAvailable } from "./helpers/sandbox";
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
let closedPort = 0;
/** Whether this machine can start Chromium with its process sandbox. */
let sandboxOK = true;

const NAMES = [
  "site.example",
  "cdn.example",
  "internal.example",
  "www.google-analytics.com",
  "www.googletagmanager.com",
  "metadata.example",
  "stats.example",
  "dead.example",
];

function egress(): EgressOptions {
  return {
    policy: {
      allowAddress: (address, port) =>
        address === "127.0.0.1" && (port === publicPort || port === closedPort),
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
  const probe = createTcpServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  closedPort = (probe.address() as { port: number }).port;
  await new Promise((done) => probe.close(done));
  sandboxOK = await sandboxAvailable();
  if (!sandboxOK)
    console.warn(
      "Chromium sandbox cannot start here; scanner tests run without it",
    );
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
          `<script>fetch("http://stats.example:${publicPort}/nocors/matomo.php?idsite=1").catch(() => {});</script>`,
        ),
      );
    } else if (path === "/spoof") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page(
          `<script>fetch("http://stats.example:${publicPort}/spoof/matomo.php?idsite=1", { mode: "no-cors" }).catch(() => {});</script>`,
        ),
      );
    } else if (path === "/spoof/matomo.php") {
      // A destination pretending the scanner's filter refused it.
      res.writeHead(204, { "x-privacylens-blocked": "1" }).end();
    } else if (path === "/spoofed-document") {
      res.writeHead(200, {
        "content-type": "text/html",
        "x-privacylens-blocked": "1",
      });
      res.end(page("<p>hello</p>"));
    } else if (path === "/webrtc") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page(`<script>
          (async () => {
            const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:" + new URLSearchParams(location.search).get("udp") }] });
            pc.createDataChannel("x");
            await pc.setLocalDescription(await pc.createOffer());
          })().catch(() => {});
        </script>`),
      );
    } else if (path === "/memory") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page(
          `<script>const hold = []; setInterval(() => { hold.push(new Uint8Array(64 * 1024 * 1024).fill(1)); }, 40);</script>`,
        ),
      );
    } else if (path === "/endless") {
      res.writeHead(200, { "content-type": "text/plain" });
      const timer = setInterval(() => res.write(Buffer.alloc(65536, 97)), 2);
      res.on("close", () => clearInterval(timer));
    } else if (path === "/download") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page(
          `<script>fetch("http://cdn.example:${publicPort}/endless", { mode: "no-cors" }).catch(() => {});</script>`,
        ),
      );
    } else if (path === "/jsnav") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page(`<script>
          fetch("http://stats.example:${publicPort}/matomo.php?idsite=1", { mode: "no-cors" }).catch(() => {});
          setTimeout(() => location.replace("http://stats.example:${publicPort}/landing"), 400);
        </script>`),
      );
    } else if (path === "/landing") {
      res
        .writeHead(200, { "content-type": "text/html" })
        .end(page("<p>landing</p>"));
    } else if (path === "/blank") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page(`<script>
          fetch("http://stats.example:${publicPort}/matomo.php?idsite=1", { mode: "no-cors" }).catch(() => {});
          setTimeout(() => location.replace("about:blank"), 400);
        </script>`),
      );
    } else if (path === "/ok-first-party") {
      res.writeHead(204).end();
    } else if (path === "/flood") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page(`<script>
          (async () => {
            for (let i = 0; i < 600; i++) fetch("/ok-first-party?i=" + i).catch(() => {});
            await new Promise((r) => setTimeout(r, 300));
            fetch("http://stats.example:${publicPort}/matomo.php?idsite=1", { mode: "no-cors" }).catch(() => {});
          })();
        </script>`),
      );
    } else if (path === "/hsts") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page(
          `<script>fetch("http://www.google-analytics.com:${publicPort}/g/collect?v=2", { mode: "no-cors" }).catch(() => {});</script>`,
        ),
      );
    } else if (path === "/failures") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page(`<script>
          fetch("http://dead.example:${closedPort}/matomo.php?idsite=1", { mode: "no-cors" }).catch(() => {});
          fetch("http://nowhere.example:${publicPort}/matomo.php?idsite=1", { mode: "no-cors" }).catch(() => {});
        </script>`),
      );
    } else if (path === "/cmpspoof") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<!doctype html><title>x</title><script>
          const boom = () => { throw new Error("\u001b[2J\u001b]0;pwned\u0007 forged line"); };
          Document.prototype.querySelector = boom;
          Document.prototype.querySelectorAll = () => [{}];
          Element.prototype.querySelector = () => ({});
        </script><p>no banner here</p>`,
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

const options = () => ({
  egress: egress(),
  settleMs: 800,
  timeoutMs: 25_000,
  chromiumSandbox: sandboxOK,
});

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
      scanLive(`http://127.0.0.1:${port}/`, {
        timeoutMs: 15_000,
        chromiumSandbox: sandboxOK,
      }),
    ).rejects.toBeInstanceOf(UnsafeTargetError);
    await expect(
      scanLive(`http://localhost:${port}/`, {
        timeoutMs: 15_000,
        chromiumSandbox: sandboxOK,
      }),
    ).rejects.toBeInstanceOf(UnsafeTargetError);
    await new Promise((done) => probe.close(done));
    expect(hits).toBe(0);
  }, 40_000);

  it("reports an unresolvable name as a failure, not as a safety refusal", async () => {
    const error = await scanLive("http://no-such-host.invalid/", {
      timeoutMs: 15_000,
      chromiumSandbox: sandboxOK,
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
        scanLive(target, { timeoutMs: 15_000, chromiumSandbox: sandboxOK }),
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

  it("cannot be made to hide a request by forging the refusal header", async () => {
    const report = await scanLive(
      `http://site.example:${publicPort}/spoof`,
      options(),
    );
    const matomo = report.technologies.find((t) => t.name === "Matomo");
    expect(matomo).toMatchObject({ observation: "observed" });
    expect(matomo?.evidence.join(" ")).toMatch(
      /Outcome: completed \(HTTP 204\)/,
    );
    expect(report.concerns.map((c) => c.title)).toContain(
      "Tracking before interaction",
    );
    expect(report.provenance?.egress.blockedConnections).toBe(0);
    const request = report.thirdPartyRequests.find(
      (r) => r.domain === "stats.example",
    );
    expect(request).toMatchObject({
      outcome: "completed",
      classification: "observed",
    });
  }, 30_000);

  it("is not fooled when the scanned document itself forges the header", async () => {
    const report = await scanLive(
      `http://site.example:${publicPort}/spoofed-document`,
      options(),
    );
    expect(report.status).toBe("completed");
    expect(report.provenance?.egress.blockedConnections).toBe(0);
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

describe("WebRTC stays closed", () => {
  let sensor: UdpSocket;
  let datagrams = 0;
  let udpPort = 0;
  let controlSawTraffic = false;

  beforeAll(async () => {
    sensor = createSocket("udp4");
    sensor.on("message", () => {
      datagrams += 1;
    });
    await new Promise<void>((done) => sensor.bind(0, "127.0.0.1", done));
    udpPort = sensor.address().port;

    // Positive control: with no proxy and no WebRTC flag, Chromium DOES send
    // STUN here. If it does not (some CI sandboxes), the behavioral test below
    // would prove nothing, so it is skipped explicitly.
    const browser = await chromium.launch({ headless: true });
    try {
      const control = await browser.newPage();
      await control.goto(
        `http://127.0.0.1:${publicPort}/webrtc?udp=${udpPort}`,
      );
      await control.waitForTimeout(2500);
    } finally {
      await browser.close();
    }
    controlSawTraffic = datagrams > 0;
    datagrams = 0;
  }, 30_000);

  afterAll(() => {
    sensor.close();
  });

  it("keeps the WebRTC policy flag in the browser arguments", () => {
    expect(BROWSER_ARGS).toContain(
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    );
    expect(BROWSER_ARGS).toContain("--disable-quic");
    expect(
      BROWSER_ARGS.some((arg) =>
        arg.startsWith("--host-resolver-rules=MAP * ~NOTFOUND"),
      ),
    ).toBe(true);
  });

  it("sends no UDP datagrams around the proxy", async (context) => {
    if (!controlSawTraffic) {
      console.warn(
        "WebRTC control produced no STUN traffic in this environment; behavioral check skipped",
      );
      context.skip();
      return;
    }
    await scanLive(`http://site.example:${publicPort}/webrtc?udp=${udpPort}`, {
      ...options(),
      settleMs: 2500,
    });
    expect(datagrams).toBe(0);
  }, 40_000);
});

describe("browser sandbox", () => {
  it("is enabled by default and recorded in the report", async () => {
    // No explicit chromiumSandbox: this exercises the default itself.
    const report = await scanLive(`http://site.example:${publicPort}/`, {
      ...options(),
      chromiumSandbox: undefined,
    });
    expect(report.provenance?.browser.sandbox).toBe(sandboxOK);
    if (sandboxOK) {
      expect(report.limitations.join(" ")).not.toMatch(/sandbox was disabled/);
    }
  }, 30_000);

  it("says so in the report when the sandbox is switched off", async () => {
    const report = await scanLive(`http://site.example:${publicPort}/`, {
      ...options(),
      chromiumSandbox: false,
    });
    expect(report.provenance?.browser.sandbox).toBe(false);
    expect(report.limitations.join(" ")).toMatch(/sandbox was disabled/);
  }, 30_000);

  it("launches Chromium processes without --no-sandbox when the sandbox is on", async (context) => {
    if (!sandboxOK) return context.skip();
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
    expect(
      (await run(true)).some((args) => args.includes("--no-sandbox")),
    ).toBe(false);
    // Control: Playwright does add the flag when the sandbox is off.
    expect(
      (await run(false)).some((args) => args.includes("--no-sandbox")),
    ).toBe(true);
  }, 40_000);
});

describe("resource limits and cleanup", () => {
  const leftovers = async () => {
    await new Promise((done) => setTimeout(done, 1500));
    return (await listProcesses()).filter(
      (proc) =>
        proc.pid !== process.pid &&
        // A leftover would be a Chromium binary carrying the run marker.
        /^\/\S*(?:chrom|headless)/i.test(proc.args) &&
        proc.args.includes("--privacylens-run=privacylens-run-"),
    );
  };

  it("stops a page that allocates memory without bound, and leaves no process behind", async () => {
    const started = Date.now();
    const error = await scanLive(`http://site.example:${publicPort}/memory`, {
      ...options(),
      timeoutMs: 40_000,
      settleMs: 30_000,
      maxMemoryBytes: 1024 * 1024 * 1024,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScanLimitError);
    expect((error as Error).message).toMatch(/memory/);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(await leftovers()).toEqual([]);
  }, 60_000);

  it("stops a page that downloads without bound, and leaves no process behind", async () => {
    const started = Date.now();
    const error = await scanLive(`http://site.example:${publicPort}/download`, {
      ...options(),
      timeoutMs: 40_000,
      settleMs: 30_000,
      egress: { ...egress(), limits: { maxTotalBytes: 2 * 1024 * 1024 } },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScanLimitError);
    expect((error as Error).message).toMatch(/downloaded more data/);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(await leftovers()).toEqual([]);
  }, 60_000);

  it("rejects a settle time that leaves no room to load the page", async () => {
    await expect(
      scanLive(`http://site.example:${publicPort}/`, {
        ...options(),
        timeoutMs: 5_000,
        settleMs: 4_500,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("leaves no process behind after a normal scan", async () => {
    await scanLive(`http://site.example:${publicPort}/`, options());
    expect(await leftovers()).toEqual([]);
  }, 30_000);
});

describe("evidence accuracy under adversarial pages", () => {
  it("judges first party by the page the server delivered, not where script navigates", async () => {
    const report = await scanLive(
      `http://site.example:${publicPort}/jsnav`,
      options(),
    );
    expect(report.targetUrl).toBe(`http://site.example:${publicPort}`);
    expect(report.provenance?.finalOrigin).toBe(
      `http://site.example:${publicPort}`,
    );
    expect(report.technologies.find((t) => t.name === "Matomo")).toMatchObject({
      observation: "observed",
    });
    expect(report.concerns.map((c) => c.title)).toContain(
      "Tracking before interaction",
    );
    expect(report.limitations.join(" ")).toMatch(
      /navigated to a different address after loading/,
    );
  }, 30_000);

  it("never reports a non-web final address as the target", async () => {
    const report = await scanLive(
      `http://site.example:${publicPort}/blank`,
      options(),
    );
    expect(report.targetUrl).toBe(`http://site.example:${publicPort}`);
    expect(JSON.stringify(report)).not.toContain('"null"');
    expect(report.limitations.join(" ")).toMatch(/non-web address/);
    expect(report.concerns.map((c) => c.title)).toContain(
      "Tracking before interaction",
    );
  }, 30_000);

  it("cannot hide a tracker behind a flood of ordinary requests", async () => {
    const report = await scanLive(
      `http://site.example:${publicPort}/flood`,
      options(),
    );
    expect(report.provenance?.droppedRequests).toBeGreaterThan(0);
    expect(report.technologies.find((t) => t.name === "Matomo")).toMatchObject({
      observation: "observed",
    });
    const titles = report.concerns.map((c) => c.title);
    expect(titles).toContain("Tracking before interaction");
    expect(titles).toContain("Some requests are not listed");
  }, 40_000);

  it("does not report Chromium's synthetic HSTS redirect as a completed request", async () => {
    const report = await scanLive(
      `http://site.example:${publicPort}/hsts`,
      options(),
    );
    const evidence =
      report.technologies
        .find((t) => t.name === "Google Analytics")
        ?.evidence.join(" ") ?? "";
    expect(evidence).not.toMatch(/HTTP 307/);
    for (const request of report.thirdPartyRequests.filter(
      (r) => r.domain === "www.google-analytics.com",
    )) {
      expect(request.outcome).not.toBe("completed");
    }
  }, 30_000);

  it("labels DNS and connection failures as failed, never as refused for safety", async () => {
    const report = await scanLive(
      `http://site.example:${publicPort}/failures`,
      options(),
    );
    const requests = report.thirdPartyRequests.filter((r) =>
      ["dead.example", "nowhere.example"].includes(r.domain),
    );
    expect(requests.length).toBe(2);
    for (const request of requests) {
      expect(request.outcome, request.domain).toBe("failed");
      expect(request.classification, request.domain).toBe("observed");
    }
    expect(report.provenance?.egress.blockedConnections).toBe(0);
    expect(report.provenance?.egress.failedConnections).toBeGreaterThanOrEqual(
      2,
    );
    expect(report.limitations.join(" ")).toMatch(
      /failed because a name did not resolve/,
    );
  }, 30_000);

  it("cannot be made to forge or break consent-manager detection", async () => {
    const report = await scanLive(
      `http://site.example:${publicPort}/cmpspoof`,
      options(),
    );
    expect(report.cmp).toEqual({ detected: false });
    expect(JSON.stringify(report)).not.toMatch(/forged|pwned|\\u001b/);
  }, 30_000);
});

describe("redaction edge cases", () => {
  it("does not stop at punctuation inside a URL", () => {
    for (const text of [
      "failed at http://site.example:6000/a)b?token=SECRETINURL",
      "failed at http://site.example:6000/it's?token=SECRETINURL now",
      `failed at "http://site.example:6000/q"x?token=SECRETINURL"`,
    ]) {
      const out = redactUrls(text);
      expect(out, text).not.toContain("SECRETINURL");
      expect(out, text).toContain("http://site.example:6000");
    }
  });

  it("redacts data, blob and javascript URLs entirely", () => {
    const out = redactUrls(
      "see data:text/html,<b>secret</b> and javascript:alert(1) and blob:https://a.test/uuid-1",
    );
    expect(out).not.toMatch(/secret|alert|uuid-1/);
  });
});
