import { randomBytes } from "node:crypto";
import { chromium, type Request as BrowserRequest } from "playwright";
import { detectConsentManager, toCookieFindings } from "./collector-common.ts";
import { assessRequest, isThirdParty, safeDestination } from "./detectors.ts";
import {
  browserTree,
  killTree,
  processTreeSupported,
  totalRssBytes,
} from "./browser-process.ts";
import {
  BLOCKED_HEADER,
  startEgressProxy,
  type EgressOptions,
} from "./egress-proxy.ts";
import { SIGNATURE_SET_VERSION } from "./signatures.ts";
import {
  REPORT_SCHEMA_VERSION,
  type RequestFinding,
  type ScanReport,
  type TechnologyFinding,
} from "./types.ts";
import { UnsafeTargetError } from "./url-policy.ts";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_SETTLE_MS = 4_000;
/**
 * The browser must not resolve names or send UDP itself. The WebRTC policy is
 * load-bearing: without it a page's RTCPeerConnection sends STUN datagrams
 * around the proxy (tests/scan-live.test.ts proves it stays closed).
 */
export const BROWSER_ARGS = [
  "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
  "--disable-quic",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  // Caps a page's JavaScript heap so a runaway script fails its own tab instead
  // of exhausting the machine.
  "--js-flags=--max-old-space-size=512",
];

const MAX_RECORDED_REQUESTS = 500;
/** Requests that match a signature are kept past the general cap, up to this. */
const MAX_SIGNIFICANT_REQUESTS = 2000;
const DEFAULT_MAX_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
const SHUTDOWN_GRACE_MS = 5_000;
const MAX_URL_LENGTH = 2048;

export interface ScanLiveOptions {
  timeoutMs?: number;
  /** Extra time after the load event to catch delayed requests. */
  settleMs?: number;
  scannerVersion?: string;
  /**
   * Resolver, policy and limits for the egress filter. Meant for tests; the
   * command-line tool never exposes it, so users cannot scan private ranges.
   */
  egress?: EgressOptions;
  /**
   * Chromium's process sandbox. On by default; the scan fails if it cannot
   * start rather than silently running without it. Only the command line's
   * explicit --unsafe-no-sandbox (or a test on a restricted CI host) turns it off.
   */
  chromiumSandbox?: boolean;
  /** Stop the scan if the browser's processes together exceed this many bytes. */
  maxMemoryBytes?: number;
}

/** A scan stopped by one of its own limits (time, memory or download size). */
export class ScanLimitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ScanLimitError";
  }
}

const LIMIT_MESSAGES = {
  time: "The scan did not finish within the time limit",
  memory:
    "The page used more memory than the scan allows, so the scan was stopped",
  download:
    "The page downloaded more data than the scan allows, so the scan was stopped",
} as const;

interface RawRequest {
  url: URL;
  resourceType: string;
  timeMs: number;
  outcome?: RequestFinding["outcome"];
  status?: number;
}

/** Accepts only an absolute http(s) URL without credentials. */
export function parseTargetUrl(input: string): URL {
  if (input.length > MAX_URL_LENGTH)
    throw new UnsafeTargetError("URL is too long");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeTargetError("Enter an absolute http:// or https:// URL");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new UnsafeTargetError("Only http and https URLs are accepted");
  if (url.username || url.password)
    throw new UnsafeTargetError("Credentials in URLs are not accepted");
  if (!url.hostname) throw new UnsafeTargetError("A hostname is required");
  url.hash = "";
  return url;
}

/**
 * Error text from the browser can quote full URLs including paths, queries and
 * tokens. Reduce every URL in a message to its origin before showing it. A URL
 * is taken to run to the next whitespace, so punctuation inside a URL cannot
 * end the match early and leave a query behind.
 */
export function redactUrls(message: string): string {
  return message
    .replace(
      /\b(data|blob|javascript|filesystem):[^\s]*/gi,
      (_match, scheme: string) => `${scheme}:[redacted]`,
    )
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, (match) => {
      try {
        const url = new URL(match);
        return url.origin === "null"
          ? `${url.protocol}//[redacted]`
          : url.origin;
      } catch {
        return "[url]";
      }
    });
}

function portOf(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80;
}

function isWeb(url: URL): boolean {
  return ["http:", "https:", "ws:", "wss:"].includes(url.protocol);
}

function describeOutcome(raw: RawRequest): string {
  if (raw.outcome === "blocked")
    return "Outcome: refused by the local egress filter.";
  if (raw.outcome === "failed")
    return "Outcome: the browser reported the request as failed. It may still have reached the server, for example when the browser blocked a cross-origin response.";
  if (raw.outcome === "completed")
    return `Outcome: completed${raw.status ? ` (HTTP ${raw.status})` : ""}.`;
  return "Outcome: not recorded.";
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function tryUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * Scans one public website with headless Chromium on this machine. All browser
 * traffic goes through a local egress filter that refuses non-public addresses
 * at connection time, so redirects, subresources, frames and WebSockets cannot
 * reach the user's own network. That is a convenience safeguard for a tool on
 * the user's machine, not the infrastructure isolation hosted scanning needs.
 */
export async function scanLive(
  target: string,
  options: ScanLiveOptions = {},
): Promise<ScanReport> {
  const url = parseTargetUrl(target);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  if (settleMs + 2_000 > timeoutMs)
    throw new RangeError(
      "The settle time must leave at least two seconds of the time limit for loading the page",
    );
  const sandbox = options.chromiumSandbox ?? true;
  const maxMemoryBytes = options.maxMemoryBytes ?? DEFAULT_MAX_MEMORY_BYTES;
  const startedAt = Date.now();
  const runMarker = `privacylens-run-${randomBytes(8).toString("hex")}`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let abortReason: keyof typeof LIMIT_MESSAGES | undefined;

  /** Stops the scan for one of its own limits and kills the browser outright. */
  const abort = (reason: keyof typeof LIMIT_MESSAGES): void => {
    if (abortReason) return;
    abortReason = reason;
    void (async () => {
      killTree(await browserTree(runMarker).catch(() => []));
      void browser?.close().catch(() => undefined);
    })();
  };

  const proxy = await startEgressProxy({
    ...options.egress,
    onBudgetExceeded: () => abort("download"),
  });
  const deadline = setTimeout(() => abort("time"), timeoutMs);
  let watching = false;
  const watchdog = processTreeSupported
    ? setInterval(() => {
        if (watching || abortReason) return;
        watching = true;
        void browserTree(runMarker)
          .then((tree) => {
            if (totalRssBytes(tree) > maxMemoryBytes) abort("memory");
          })
          .catch(() => undefined)
          .finally(() => {
            watching = false;
          });
      }, 500)
    : undefined;

  const collect = async (): Promise<ScanReport> => {
    try {
      browser = await chromium.launch({
        headless: true,
        timeout: timeoutMs,
        chromiumSandbox: sandbox,
        proxy: {
          server: `http://127.0.0.1:${proxy.port}`,
          username: proxy.credentials.username,
          password: proxy.credentials.password,
          // Chromium skips proxies for loopback by default; this forces
          // everything through the filter so loopback is refused like any
          // other private range.
          bypass: "<-loopback>",
        },
        args: [...BROWSER_ARGS, `--privacylens-run=${runMarker}`],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sandbox && /sandbox|namespace|zygote/i.test(message))
        throw new Error(
          "Chromium's sandbox could not start on this system. Fix the system (for example allow unprivileged user namespaces) or, accepting that a browser exploit would then run with your privileges, re-run with --unsafe-no-sandbox",
          { cause: error },
        );
      throw error;
    }
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      locale: "en-US",
    });
    const page = await context.newPage();
    context.on("page", (popup) => {
      if (popup !== page) void popup.close().catch(() => undefined);
    });

    const navigationStart = Date.now();
    const recorded = new Map<BrowserRequest, RawRequest>();
    const sockets: RawRequest[] = [];
    let dropped = 0;
    let significantKept = 0;

    // Requests that match a signature are never crowded out by ordinary ones:
    // a page cannot hide a tracker behind a flood of first-party requests.
    const keep = (url: URL, resourceType: string): boolean => {
      const significant =
        assessRequest(url, resourceType).classification !== "unknown";
      if (recorded.size + sockets.length < MAX_RECORDED_REQUESTS) {
        if (significant) significantKept += 1;
        return true;
      }
      if (significant && significantKept < MAX_SIGNIFICANT_REQUESTS) {
        significantKept += 1;
        return true;
      }
      dropped += 1;
      return false;
    };

    context.on("request", (request) => {
      const requestUrl = tryUrl(request.url());
      if (!requestUrl || !isWeb(requestUrl)) return;
      const raw: RawRequest = {
        url: requestUrl,
        resourceType: request.resourceType(),
        timeMs: Date.now() - navigationStart,
      };
      if (keep(requestUrl, raw.resourceType)) recorded.set(request, raw);
    });
    context.on("requestfinished", (request) => {
      const raw = recorded.get(request);
      if (!raw) return;
      void request
        .response()
        .then((response) => {
          if (!response) return;
          const headers = response.headers();
          // Chromium answers an HSTS upgrade with a synthetic 307 that never
          // reached any server; it is not a request to report.
          if (headers["non-authoritative-reason"] === "HSTS") {
            recorded.delete(request);
            return;
          }
          raw.status = response.status();
          const marker = headers[BLOCKED_HEADER];
          // Only the proxy knows the per-run marker, so a site cannot forge it.
          raw.outcome =
            marker === proxy.blockMarker
              ? "blocked"
              : marker === `${proxy.blockMarker}:limit` ||
                  marker === `${proxy.blockMarker}:failed`
                ? "failed"
                : "completed";
        })
        .catch(() => undefined);
    });
    context.on("requestfailed", (request) => {
      const raw = recorded.get(request);
      if (!raw) return;
      raw.outcome = proxy.wasBlocked(raw.url.hostname, portOf(raw.url))
        ? "blocked"
        : "failed";
    });
    page.on("websocket", (socket) => {
      const socketUrl = tryUrl(socket.url());
      if (!socketUrl) return;
      const raw: RawRequest = {
        url: socketUrl,
        resourceType: "websocket",
        timeMs: Date.now() - navigationStart,
      };
      if (!keep(socketUrl, "websocket")) return;
      sockets.push(raw);
      socket.on("socketerror", () => {
        raw.outcome = proxy.wasBlocked(socketUrl.hostname, portOf(socketUrl))
          ? "blocked"
          : "failed";
      });
      socket.on("framereceived", () => {
        raw.outcome = "completed";
      });
    });

    /** Turns a filter refusal of the target itself into the right error. */
    const refuseIfBlocked = (force = false): void => {
      const reason = proxy.blockReason(url.hostname, portOf(url));
      if (reason === "unresolvable")
        throw new Error("The hostname could not be resolved");
      if (reason === "connect-failed")
        throw new Error("Could not connect to the target");
      if (reason === "non-public-address" || (force && reason === undefined))
        throw new UnsafeTargetError(
          "The target resolves to a non-public address and was refused",
        );
      if (reason)
        throw new Error("The connection to the target was not allowed");
    };

    let response;
    try {
      response = await page.goto(url.toString(), {
        waitUntil: "load",
        timeout: timeoutMs,
      });
    } catch (error) {
      if (abortReason) throw error;
      refuseIfBlocked();
      // The cause is kept for debugging but never printed: it can quote full URLs.
      throw new Error(
        `Could not load the page: ${redactUrls(error instanceof Error ? error.message : String(error))}`,
        { cause: error },
      );
    }
    if (!response) throw new Error("The page did not produce a response");
    const responseMarker = response.headers()[BLOCKED_HEADER];
    if (responseMarker === proxy.blockMarker) refuseIfBlocked(true);
    if (
      responseMarker === `${proxy.blockMarker}:failed` ||
      responseMarker === `${proxy.blockMarker}:limit`
    ) {
      refuseIfBlocked();
      throw new Error("Could not connect to the target");
    }
    const status = response.status();
    if (status < 200 || status >= 300) {
      throw new Error(
        `The page answered with HTTP status ${status}; no report was produced`,
      );
    }
    // The site is the page the server delivered (after HTTP redirects), not
    // wherever page script navigates later: a page must not be able to move its
    // own "first party" to a tracker's host.
    const loaded = tryUrl(response.url());
    if (!loaded || !["http:", "https:"].includes(loaded.protocol))
      throw new Error("The page did not load from a web address");

    await page.waitForTimeout(settleMs);
    // Let outcome callbacks that resolve responses finish before reading.
    await page.waitForTimeout(100);

    const afterUrl = tryUrl(page.url());
    const cmp = await detectConsentManager(page);
    const cookies = toCookieFindings(await context.cookies(), loaded.hostname);

    const technologies = new Map<string, TechnologyFinding>();
    const thirdPartyRequests: RequestFinding[] = [];
    let trackingBeforeInteraction = false;
    const all = [...recorded.values(), ...sockets];
    for (const raw of all) {
      const thirdParty = isThirdParty(loaded.hostname, raw.url.hostname);
      const assessment = assessRequest(raw.url, raw.resourceType);
      const detected = assessment.technology;
      // A refused request never reached its destination, so it proves nothing
      // about what that destination would have received.
      const delivered = raw.outcome !== "blocked";
      if (detected && assessment.signature && delivered) {
        if (assessment.classification === "observed" && thirdParty)
          trackingBeforeInteraction = true;
        const existing = technologies.get(detected.name);
        const rank = { unknown: 0, inferred: 1, observed: 2 } as const;
        const observation =
          existing &&
          rank[existing.observation] >= rank[assessment.classification]
            ? existing.observation
            : assessment.classification === "observed"
              ? "observed"
              : "inferred";
        technologies.set(detected.name, {
          ...detected,
          signature: assessment.signature,
          observation,
          evidence: [
            ...new Set([
              ...(existing?.evidence ?? []),
              `${assessment.reason} Destination: ${safeDestination(raw.url)}. ${describeOutcome(raw)}`,
            ]),
          ],
        });
      }
      if (thirdParty) {
        thirdPartyRequests.push({
          url: safeDestination(raw.url),
          domain: raw.url.hostname,
          technology: delivered ? detected?.name : undefined,
          timeMs: raw.timeMs,
          beforeConsent: true,
          resourceType: raw.resourceType,
          classification: delivered ? assessment.classification : "unknown",
          ...(raw.outcome ? { outcome: raw.outcome } : {}),
        });
      }
    }

    const egress = proxy.stats();
    const crossSite =
      loaded.origin !== url.origin &&
      isThirdParty(url.hostname, loaded.hostname);
    const limitations = [
      `This result covers the initial page load and a ${Math.round(settleMs / 1000)}-second settle window. Nothing on the page was clicked and no consent choice was made.`,
      "Requests are recorded when the browser starts them; the outcome (completed, failed or refused) is the browser's report. Request payloads, cookie values, headers, URL paths and query strings are not recorded.",
      "Requests to private, local or otherwise non-public addresses are refused by a local egress filter and recorded as refused. They are not counted as evidence about their destination.",
      "A request whose outcome is failed may still have reached its server, and a name that did not resolve or a host that refused the connection is a failure, not a refusal.",
      "The scan used one headless Chromium visit from this machine's network. Sites can respond differently to automated browsers, locations and repeat visits.",
      "Destinations marked unknown matched no recognized signature; that does not mean they are harmless or that they track.",
      "CMP presence is inferred from known DOM selectors; absence is not proof that consent is unnecessary.",
      "No GDPR compliance conclusion or privacy score is provided.",
    ];
    if (crossSite)
      limitations.push(
        "The page redirected to a different site; first-party status is judged against the site that loaded.",
      );
    if (afterUrl && afterUrl.origin !== loaded.origin)
      limitations.push(
        afterUrl.protocol === "http:" || afterUrl.protocol === "https:"
          ? "Page script navigated to a different address after loading; evidence is judged against the page that loaded."
          : "Page script navigated to a non-web address after loading; evidence is judged against the page that loaded.",
      );
    if (egress.blockedConnections > 0)
      limitations.push(
        `${egress.blockedConnections} connection attempt(s) were refused by the egress filter.`,
      );
    if (egress.failedConnections > 0)
      limitations.push(
        `${egress.failedConnections} connection attempt(s) failed because a name did not resolve or a host refused the connection.`,
      );
    if (egress.limitRefusals > 0)
      limitations.push(
        `${egress.limitRefusals} connection(s) were turned away only because the scanner's connection limit was reached; those requests are recorded as failed, not refused for safety.`,
      );
    if (egress.blockedDestinationsTruncated)
      limitations.push(
        `More connections were refused than the ${egress.blockedDestinations.length} destinations listed in the provenance.`,
      );
    if (!sandbox)
      limitations.push(
        "Chromium's process sandbox was disabled for this scan at the user's request.",
      );
    if (!processTreeSupported)
      limitations.push(
        "The memory limit is not enforced on this operating system.",
      );
    const concerns: ScanReport["concerns"] = trackingBeforeInteraction
      ? [
          {
            title: "Tracking before interaction",
            detail:
              "During the initial page load, before any consent choice, the browser requested a recognized third-party collection endpoint. The outcome is recorded; what was sent is not.",
            level: "attention",
          },
        ]
      : [];
    if (dropped > 0)
      concerns.push({
        title: "Some requests are not listed",
        detail: `${dropped} request(s) that matched no known signature were not listed individually after the recording limit. Requests matching a signature were still evaluated.`,
        level: "info",
      });

    return {
      schemaVersion: REPORT_SCHEMA_VERSION,
      targetUrl: loaded.origin,
      scannedAt: new Date(startedAt).toISOString(),
      status: "completed",
      signatureSetVersion: SIGNATURE_SET_VERSION,
      technologies: [...technologies.values()],
      cookies,
      thirdPartyRequests,
      cmp,
      concerns,
      limitations,
      provenance: {
        mode: "local-cli",
        scanner: {
          name: "privacylens",
          version: options.scannerVersion ?? "unknown",
        },
        browser: { name: "chromium", version: browser.version(), sandbox },
        requestedOrigin: url.origin,
        finalOrigin: loaded.origin,
        durationMs: Date.now() - startedAt,
        settleMs,
        timeoutMs,
        droppedRequests: dropped,
        egress: {
          allowedConnections: egress.allowedConnections,
          blockedConnections: egress.blockedConnections,
          limitRefusals: egress.limitRefusals,
          failedConnections: egress.failedConnections,
          blockedDestinationsTruncated: egress.blockedDestinationsTruncated,
          blockedDestinations: egress.blockedDestinations,
        },
      },
    };
  };

  try {
    return await collect();
  } catch (error) {
    // A scan stopped by its own limit fails with that reason, not with whatever
    // error the closing browser happened to throw.
    if (abortReason)
      throw new ScanLimitError(LIMIT_MESSAGES[abortReason], { cause: error });
    throw error;
  } finally {
    clearTimeout(deadline);
    if (watchdog) clearInterval(watchdog);
    // Playwright's close can wait about 30 seconds on a frozen browser; give it
    // a short grace period, then kill whatever is left.
    await Promise.race([
      browser?.close().catch(() => undefined),
      sleep(SHUTDOWN_GRACE_MS),
    ]);
    killTree(await browserTree(runMarker).catch(() => []));
    await proxy.close();
  }
}
