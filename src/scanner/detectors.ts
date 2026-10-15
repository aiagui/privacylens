import { getDomain } from "tldts";
import {
  signatures,
  SIGNATURE_SET_VERSION,
  type Signature,
} from "./signatures.ts";
import type { Classification, TechnologyFinding } from "./types.ts";

/**
 * Private suffixes are honored so tenants of a shared platform (alice.github.io
 * and bob.github.io, *.vercel.app, *.blogspot.com) are different parties.
 */
export function registrableDomain(hostname: string): string {
  const host = hostname.replace(/\.$/, "");
  return (
    getDomain(host, { allowPrivateDomains: true }) ??
    host.replace(/^\[|\]$/g, "")
  );
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

/** A trailing dot is the same host; percent-escapes must not hide a path. */
function normalized(url: URL): { host: string; path: string } {
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path if it is not valid percent-encoding.
  }
  return { host: url.hostname.toLowerCase().replace(/\.$/, ""), path };
}

function matchSignature(url: URL): Signature | undefined {
  const { host, path } = normalized(url);
  return signatures.find((candidate) => {
    if (candidate.domains.length === 0)
      return candidate.path?.test(path) ?? false;
    return (
      hostMatches(candidate, host) &&
      (!candidate.path || candidate.path.test(path))
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
    const { host } = normalized(url);
    const vendor = signatures.find((candidate) => hostMatches(candidate, host));
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
      reason: `Request to a recognized ${signature.name} collection endpoint (${signature.id}). Initiation only; payload not inspected.${
        signature.collectionSourced
          ? ""
          : " This endpoint pattern is not yet confirmed by vendor documentation."
      }`,
    };
  }
  return {
    classification: "inferred",
    ...reference,
    reason: `Resource requested from a recognized ${signature.name} host (${signature.id}). This does not show that data was sent.`,
  };
}

/**
 * True only when a recognized signature's own collection rule matches and the
 * request is not a script load. Vendor-agnostic path guesses are not evidence.
 */
export function isTrackingRequest(url: URL, resourceType: string): boolean {
  if (resourceType === "script") return false;
  const signature = matchSignature(url);
  if (!signature?.collection) return false;
  const { path } = normalized(url);
  return (
    signature.collection.test(path) &&
    (signature.collectionQuery?.test(url.search.replace(/^\?/, "")) ?? true)
  );
}

export function safeDestination(url: URL): string {
  // Path and query can contain identifiers or credentials. Origin is sufficient evidence of destination.
  return url.origin;
}
