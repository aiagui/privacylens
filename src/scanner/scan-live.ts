import { chromium, type Request as BrowserRequest } from "playwright";
import { detectConsentManager, toCookieFindings } from "./collector-common.ts";
import { assessRequest, isThirdParty, safeDestination } from "./detectors.ts";
import {
  BLOCKED_HEADER,
  startEgressProxy,
  type EgressOptions,
} from "./egress-proxy.ts";
import { SIGNATURE_SET_VERSION } from "./signatures.ts";
import type { RequestFinding, ScanReport, TechnologyFinding } from "./types.ts";
import { UnsafeTargetError } from "./url-policy.ts";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_SETTLE_MS = 4_000;
const MAX_RECORDED_REQUESTS = 500;
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
}

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
 * tokens. Reduce every URL in a message to its origin before showing it.
 */
export function redactUrls(message: string): string {
  return message.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi, (match) => {
    try {
      const url = new URL(match);
      return url.origin === "null" ? `${url.protocol}//[redacted]` : url.origin;
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
  const startedAt = Date.now();
  const proxy = await startEgressProxy(options.egress);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const deadline = setTimeout(() => {
    void browser?.close().catch(() => undefined);
    void proxy.close();
  }, timeoutMs);

  try {
    browser = await chromium.launch({
      headless: true,
      timeout: timeoutMs,
      proxy: {
        server: `http://127.0.0.1:${proxy.port}`,
        username: proxy.credentials.username,
        password: proxy.credentials.password,
        // Chromium skips proxies for loopback by default; this forces everything
        // through the filter so loopback is refused like any other private range.
        bypass: "<-loopback>",
      },
      args: [
        // Belt and braces: the browser must not resolve names or use UDP itself.
        "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
    });
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

    const hasRoom = (): boolean => {
      if (recorded.size + sockets.length >= MAX_RECORDED_REQUESTS) {
        dropped += 1;
        return false;
      }
      return true;
    };
    context.on("request", (request) => {
      let requestUrl: URL;
      try {
        requestUrl = new URL(request.url());
      } catch {
        return;
      }
      if (!isWeb(requestUrl)) return;
      const raw: RawRequest = {
        url: requestUrl,
        resourceType: request.resourceType(),
        timeMs: Date.now() - navigationStart,
      };
      if (hasRoom()) recorded.set(request, raw);
    });
    context.on("requestfinished", (request) => {
      const raw = recorded.get(request);
      if (!raw) return;
      void request
        .response()
        .then((response) => {
          if (!response) return;
          raw.status = response.status();
          raw.outcome =
            BLOCKED_HEADER in response.headers() ? "blocked" : "completed";
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
      try {
        const socketUrl = new URL(socket.url());
        const raw: RawRequest = {
          url: socketUrl,
          resourceType: "websocket",
          timeMs: Date.now() - navigationStart,
        };
        if (!hasRoom()) return;
        sockets.push(raw);
        socket.on("socketerror", () => {
          raw.outcome = proxy.wasBlocked(socketUrl.hostname, portOf(socketUrl))
            ? "blocked"
            : "failed";
        });
        socket.on("framereceived", () => {
          raw.outcome = "completed";
        });
      } catch {
        // An unparsable socket URL carries nothing reportable.
      }
    });

    /** Turns a filter refusal of the target itself into the right error. */
    const refuseIfBlocked = (force = false): void => {
      const reason = proxy.blockReason(url.hostname, portOf(url));
      if (reason === "unresolvable")
        throw new Error("The hostname could not be resolved");
      if (reason === "non-public-address" || (force && reason === undefined))
        throw new UnsafeTargetError(
          "The target resolves to a non-public address and was refused",
        );
      if (reason)
        throw new Error("The connection to the target was not allowed");
    };

    let navigationStatus: number | undefined;
    let navigationBlocked = false;
    try {
      const response = await page.goto(url.toString(), {
        waitUntil: "load",
        timeout: timeoutMs,
      });
      navigationStatus = response?.status();
      navigationBlocked = !!response && BLOCKED_HEADER in response.headers();
    } catch (error) {
      refuseIfBlocked();
      // The cause is kept for debugging but never printed: it can quote full URLs.
      throw new Error(
        `Could not load the page: ${redactUrls(error instanceof Error ? error.message : String(error))}`,
        { cause: error },
      );
    }
    if (navigationBlocked) refuseIfBlocked(true);
    if (
      !navigationStatus ||
      navigationStatus < 200 ||
      navigationStatus >= 300
    ) {
      throw new Error(
        `The page answered with HTTP status ${navigationStatus ?? "unknown"}; no report was produced`,
      );
    }
    await page.waitForTimeout(settleMs);
    // Let outcome callbacks that resolve responses finish before reading.
    await page.waitForTimeout(100);

    const finalUrl = new URL(page.url());
    const cmp = await page.evaluate(detectConsentManager);
    const cookies = toCookieFindings(
      await context.cookies(),
      finalUrl.hostname,
    );

    const technologies = new Map<string, TechnologyFinding>();
    const thirdPartyRequests: RequestFinding[] = [];
    let trackingBeforeInteraction = false;
    const all = [...recorded.values(), ...sockets];
    for (const raw of all) {
      const thirdParty = isThirdParty(finalUrl.hostname, raw.url.hostname);
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
      finalUrl.origin !== url.origin &&
      isThirdParty(url.hostname, finalUrl.hostname);
    const limitations = [
      `This result covers the initial page load and a ${Math.round(settleMs / 1000)}-second settle window. Nothing on the page was clicked and no consent choice was made.`,
      "Requests are recorded when the browser starts them; the outcome (completed, failed or refused) is the browser's report. Request payloads, cookie values, headers, URL paths and query strings are not recorded.",
      "Requests to private, local or otherwise non-public addresses are refused by a local egress filter and recorded as refused. They are not counted as evidence about their destination.",
      "The scan used one headless Chromium visit from this machine's network. Sites can respond differently to automated browsers, locations and repeat visits.",
      "Destinations marked unknown matched no recognized signature; that does not mean they are harmless or that they track.",
      "CMP presence is inferred from known DOM selectors; absence is not proof that consent is unnecessary.",
      "No GDPR compliance conclusion or privacy score is provided.",
    ];
    if (crossSite)
      limitations.push(
        "The page redirected to a different site; first-party status is judged against the final site.",
      );
    if (egress.blockedConnections > 0)
      limitations.push(
        `${egress.blockedConnections} connection attempt(s) were refused by the egress filter.`,
      );
    if (dropped > 0)
      limitations.push(
        `${dropped} request(s) beyond the ${MAX_RECORDED_REQUESTS}-request recording cap are not listed.`,
      );

    return {
      targetUrl: finalUrl.origin,
      scannedAt: new Date(startedAt).toISOString(),
      status: "completed",
      signatureSetVersion: SIGNATURE_SET_VERSION,
      technologies: [...technologies.values()],
      cookies,
      thirdPartyRequests,
      cmp,
      concerns: trackingBeforeInteraction
        ? [
            {
              title: "Tracking before interaction",
              detail:
                "During the initial page load, before any consent choice, the browser requested a recognized third-party collection endpoint. The outcome is recorded; what was sent is not.",
              level: "attention",
            },
          ]
        : [],
      limitations,
      provenance: {
        mode: "local-cli",
        scanner: {
          name: "privacylens",
          version: options.scannerVersion ?? "unknown",
        },
        browser: { name: "chromium", version: browser.version() },
        requestedOrigin: url.origin,
        finalOrigin: finalUrl.origin,
        durationMs: Date.now() - startedAt,
        settleMs,
        timeoutMs,
        droppedRequests: dropped,
        egress: {
          allowedConnections: egress.allowedConnections,
          blockedConnections: egress.blockedConnections,
          blockedDestinations: egress.blockedDestinations,
        },
      },
    };
  } finally {
    clearTimeout(deadline);
    await browser?.close().catch(() => undefined);
    await proxy.close();
  }
}
