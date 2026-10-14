import { chromium } from "playwright";
import { assessRequest, isThirdParty, safeDestination } from "./detectors.ts";
import { detectConsentManager, toCookieFindings } from "./collector-common.ts";
import { SIGNATURE_SET_VERSION } from "./signatures.ts";
import type { RequestFinding, ScanReport, TechnologyFinding } from "./types.ts";
import { UnsafeTargetError, validateFixtureUrl } from "./url-policy.ts";

const MAX_REQUESTS = 300;
const SCAN_TIMEOUT_MS = 12_000;

/**
 * Runs only against a caller-owned local fixture origin. Every other browser
 * request is aborted; this is not a substitute for OS/container egress policy.
 */
export async function scanFixture(
  target: string,
  fixtureOrigin: string,
): Promise<ScanReport> {
  const url = validateFixtureUrl(target, fixtureOrigin);
  const browser = await chromium.launch({
    headless: true,
    timeout: SCAN_TIMEOUT_MS,
  });
  const deadline = setTimeout(() => {
    void browser.close().catch(() => undefined);
  }, SCAN_TIMEOUT_MS);
  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
    });
    const page = await context.newPage();
    const startedAt = Date.now();
    const technologies = new Map<string, TechnologyFinding>();
    const thirdPartyRequests: RequestFinding[] = [];
    let totalRequests = 0;
    let blockedNavigation = false;
    let trackingBeforeInteraction = false;

    await context.route("**/*", async (route) => {
      totalRequests += 1;
      if (totalRequests > MAX_REQUESTS) {
        await route.abort();
        return;
      }

      const request = route.request();
      let requestUrl: URL;
      try {
        requestUrl = new URL(request.url());
      } catch {
        await route.abort();
        return;
      }

      if (!["http:", "https:"].includes(requestUrl.protocol)) {
        await route.abort();
        return;
      }

      const thirdParty = isThirdParty(url.hostname, requestUrl.hostname);
      const assessment = assessRequest(requestUrl, request.resourceType());
      const detected = assessment.technology;
      const tracking = assessment.classification === "observed";
      if (detected && assessment.signature) {
        if (tracking && thirdParty) trackingBeforeInteraction = true;
        const existing = technologies.get(detected.name);
        const evidence = `${assessment.reason} Destination: ${safeDestination(requestUrl)}`;
        technologies.set(detected.name, {
          ...detected,
          signature: assessment.signature,
          observation: tracking
            ? "observed"
            : (existing?.observation ?? "inferred"),
          evidence: [...new Set([...(existing?.evidence ?? []), evidence])],
        });
      }
      if (thirdParty) {
        thirdPartyRequests.push({
          url: safeDestination(requestUrl),
          domain: requestUrl.hostname,
          technology: detected?.name,
          timeMs: Date.now() - startedAt,
          beforeConsent: true,
          resourceType: request.resourceType(),
          classification: assessment.classification,
        });
      }

      // Never let Chromium follow a redirect implicitly after route.continue():
      // Playwright can send it before another route handler has a chance to run.
      if (requestUrl.origin !== fixtureOrigin) {
        if (request.isNavigationRequest()) blockedNavigation = true;
        await route.abort();
        return;
      }
      try {
        const response = await route.fetch({
          maxRedirects: 0,
          timeout: SCAN_TIMEOUT_MS,
        });
        if (response.status() >= 300 && response.status() < 400) {
          if (request.isNavigationRequest()) blockedNavigation = true;
          await route.abort();
          return;
        }
        await route.fulfill({ response });
      } catch {
        await route.abort();
      }
    });

    const navigationResponse = await page.goto(url.toString(), {
      waitUntil: "domcontentloaded",
      timeout: SCAN_TIMEOUT_MS,
    });
    if (
      blockedNavigation ||
      !navigationResponse ||
      navigationResponse.status() < 200 ||
      navigationResponse.status() >= 300 ||
      new URL(page.url()).origin !== fixtureOrigin
    ) {
      throw new UnsafeTargetError(
        "Navigation did not return a successful fixture response",
      );
    }
    await page.waitForTimeout(500);

    const cmp = await page.evaluate(detectConsentManager);
    const cookies = toCookieFindings(await context.cookies(), url.hostname);

    return {
      targetUrl: url.origin,
      scannedAt: new Date().toISOString(),
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
                "The browser initiated a recognized third-party request before any consent interaction. The fixture policy blocked external delivery.",
              level: "attention",
            },
          ]
        : [],
      limitations: [
        "This result covers only the initial page load. No consent choice was made.",
        "Third-party requests were observed at browser initiation but blocked before network delivery.",
        "HTTP redirects are blocked, including same-origin redirects; non-success navigation responses do not produce a completed report.",
        "Destinations marked unknown matched no recognized signature; that does not mean they are harmless or that they track.",
        "CMP presence is inferred from known DOM selectors; absence is not proof that consent is unnecessary.",
        "No GDPR compliance conclusion or privacy score is provided.",
      ],
    };
  } finally {
    clearTimeout(deadline);
    await browser.close().catch(() => undefined);
  }
}
