import type { Page } from "playwright";
import { isThirdParty } from "./detectors.ts";
import type { CookieFinding, ScanReport } from "./types.ts";

/**
 * Cookie names occasionally embed identifiers or secrets. Anything that looks
 * like one is redacted rather than published. This is a heuristic: a readable
 * name that happens to contain a personal identifier (for example
 * "user.john.smith") cannot be recognized and would be published.
 */
export function sanitizeCookieName(name: string): string {
  if (
    name.length > 128 ||
    name.includes("@") ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    /(?:bearer|token|secret|password|api[_-]?key)/i.test(name) ||
    // Names that embed an identifier rather than name a purpose: long hex or
    // base64-looking runs, JWT prefixes, or many digits.
    /[0-9a-f]{16,}/i.test(name) ||
    /[A-Za-z0-9_-]{32,}/.test(name) ||
    /^eyJ/.test(name) ||
    (name.match(/\d/g) ?? []).length >= 8
  ) {
    return "[REDACTED]";
  }
  return name;
}

interface BrowserCookie {
  name: string;
  domain: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
}

/** Maps browser cookies to findings. Values are never read into the report. */
export function toCookieFindings(
  cookies: BrowserCookie[],
  siteHostname: string,
): CookieFinding[] {
  return cookies.map((cookie) => ({
    name: sanitizeCookieName(cookie.name),
    domain: cookie.domain,
    firstParty: !isThirdParty(siteHostname, cookie.domain.replace(/^\./, "")),
    ...(cookie.expires > 0
      ? { expires: new Date(cookie.expires * 1000).toISOString() }
      : {}),
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
  }));
}

const CONSENT_MANAGERS: [string, string][] = [
  ["OneTrust", "#onetrust-banner-sdk"],
  ["Cookiebot", "#CybotCookiebotDialog"],
  ["Didomi", "#didomi-host"],
  ["Usercentrics", "#usercentrics-root"],
];

/**
 * Looks for known consent-manager elements with Playwright locators, which run
 * in an isolated world: a hostile page that overrides `querySelector` or throws
 * cannot forge a result, break the scan or smuggle text into the report. The
 * evidence string is always our own constant selector, never page content.
 */
export async function detectConsentManager(
  page: Page,
): Promise<ScanReport["cmp"]> {
  for (const [name, selector] of CONSENT_MANAGERS) {
    try {
      if ((await page.locator(selector).count()) > 0)
        return { detected: true, name, evidence: selector };
    } catch {
      // A page that breaks a lookup is treated as "not established".
    }
  }
  return { detected: false };
}
