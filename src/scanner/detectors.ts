import { getDomain } from "tldts";
import {
  signatures,
  SIGNATURE_SET_VERSION,
  type Signature,
} from "./signatures";
import type { Classification, TechnologyFinding } from "./types";

export function registrableDomain(hostname: string): string {
  return getDomain(hostname) ?? hostname.replace(/^\[|\]$/g, "");
}

export function isThirdParty(
  targetHostname: string,
  requestHostname: string,
): boolean {
  return (
    registrableDomain(targetHostname) !== registrableDomain(requestHostname)
  );
}

function hostMatches(signature: Signature, host: string): boolean {
  return signature.domains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

function matchSignature(url: URL): Signature | undefined {
  const host = url.hostname.toLowerCase();
  return signatures.find((candidate) => {
    if (candidate.domains.length === 0)
      return candidate.path?.test(url.pathname) ?? false;
    return (
      hostMatches(candidate, host) &&
      (!candidate.path || candidate.path.test(url.pathname))
    );
  });
}

export function detectTechnology(
  url: URL,
): Pick<TechnologyFinding, "name" | "category"> | undefined {
  const signature = matchSignature(url);
  // Return only the public fields: `signature` also carries internal match
  // config (domains, path regex) that must never reach a ScanReport.
  return signature
    ? { name: signature.name, category: signature.category }
    : undefined;
}

export interface RequestAssessment {
  classification: Classification;
  technology?: Pick<TechnologyFinding, "name" | "category">;
  signature?: { id: string; version: string };
  /** Why this classification, in terms a report can show. */
  reason: string;
}

/**
 * observed: a recognized vendor's collection endpoint was requested (initiation
 *   only; delivery and payload are not established).
 * inferred: a recognized vendor resource (e.g. a script) was requested; whether
 *   it sends data is not shown.
 * unknown: no signature explains the request, or a vendor domain was contacted
 *   at a path no signature recognizes.
 */
export function assessRequest(
  url: URL,
  resourceType: string,
): RequestAssessment {
  const signature = matchSignature(url);
  if (!signature) {
    const vendor = signatures.find((candidate) =>
      hostMatches(candidate, url.hostname.toLowerCase()),
    );
    return {
      classification: "unknown",
      reason: vendor
        ? `Contacted a ${vendor.name} host at a path no signature recognizes; its purpose is not established.`
        : "No known signature matches this destination; its purpose is not established.",
    };
  }
  const reference = {
    technology: { name: signature.name, category: signature.category },
    signature: { id: signature.id, version: SIGNATURE_SET_VERSION },
  };
  if (isTrackingRequest(url, resourceType)) {
    return {
      classification: "observed",
      ...reference,
      reason: `Request to a recognized ${signature.name} collection endpoint (${signature.id}). Initiation only; payload not inspected.`,
    };
  }
  return {
    classification: "inferred",
    ...reference,
    reason: `Resource requested from a recognized ${signature.name} host (${signature.id}). This does not show that data was sent.`,
  };
}

export function isTrackingRequest(url: URL, resourceType: string): boolean {
  if (resourceType === "script") return false;
  // Match whole trailing path segments: "/trending" or "/events/123" are
  // ordinary pages, not collection endpoints.
  return /(?:^|\/)(?:[gjr]\/collect|collect|tr|events?|px|(?:matomo|piwik)\.php|pixel(?:\/[^/]+)*)\/?$/i.test(
    url.pathname,
  );
}

export function safeDestination(url: URL): string {
  // Path and query can contain identifiers or credentials. Origin is sufficient evidence of destination.
  return url.origin;
}
