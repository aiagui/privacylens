import { isThirdParty } from "./detectors.ts";
import type { CookieFinding, ScanReport } from "./types.ts";

/**
 * Cookie names occasionally embed identifiers or secrets. Anything that looks
 * like one is redacted rather than published.
 */
export function sanitizeCookieName(name: string): string {
  if (
    name.length > 128 ||
    name.includes("@") ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    /(?:bearer|token|secret|password|api[_-]?key)/i.test(name)
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

/** Runs inside the page. Must stay self-contained (it is serialized). */
export function detectConsentManager(): ScanReport["cmp"] {
  const named: [string, string][] = [
    ["OneTrust", "#onetrust-banner-sdk"],
    ["Cookiebot", "#CybotCookiebotDialog"],
    ["Didomi", "#didomi-host"],
    ["Usercentrics", "#usercentrics-root"],
  ];
  for (const [name, selector] of named) {
    if (document.querySelector(selector))
      return { detected: true, name, evidence: selector };
  }
  return { detected: false };
}
