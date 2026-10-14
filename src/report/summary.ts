import type { Classification, ScanReport } from "@/scanner/types";

export interface DomainSummary {
  domain: string;
  requests: number;
  /** Every distinct classification seen for this domain, strongest first. */
  classifications: Classification[];
  technologies: string[];
}

export interface ReportSummary {
  origin: string;
  requests: number;
  domains: DomainSummary[];
  recognizedDomains: number;
  unknownDomains: number;
  technologies: number;
  cookies: number;
  firstPartyCookies: number;
  thirdPartyCookies: number;
  persistentCookies: number;
  failedRequests: number;
  refusedRequests: number;
}

const ORDER: Classification[] = ["observed", "inferred", "unknown"];

export function classificationOf(value?: Classification): Classification {
  return value ?? "unknown";
}

/**
 * The one place counts are derived. Simple View and Technical View both read
 * from this, so they cannot disagree about what the report contains.
 */
export function summarize(report: ScanReport): ReportSummary {
  const requests = Array.isArray(report.thirdPartyRequests)
    ? report.thirdPartyRequests
    : [];
  const cookies = Array.isArray(report.cookies) ? report.cookies : [];
  const byDomain = new Map<string, DomainSummary>();
  for (const request of requests) {
    const key = request.domain || "Destination unknown";
    let entry = byDomain.get(key);
    if (!entry) {
      entry = {
        domain: key,
        requests: 0,
        classifications: [],
        technologies: [],
      };
      byDomain.set(key, entry);
    }
    entry.requests += 1;
    const kind = classificationOf(request.classification);
    if (!entry.classifications.includes(kind)) entry.classifications.push(kind);
    if (request.technology && !entry.technologies.includes(request.technology))
      entry.technologies.push(request.technology);
  }
  const domains = [...byDomain.values()];
  for (const d of domains)
    d.classifications.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  let origin = "Scanned website";
  try {
    origin = new URL(report.targetUrl).origin;
  } catch {
    // keep the neutral label
  }
  const onlyUnknown = (d: DomainSummary) =>
    d.classifications.every((c) => c === "unknown");
  return {
    origin,
    requests: requests.length,
    domains,
    recognizedDomains: domains.filter((d) => !onlyUnknown(d)).length,
    unknownDomains: domains.filter(onlyUnknown).length,
    technologies: Array.isArray(report.technologies)
      ? report.technologies.length
      : 0,
    cookies: cookies.length,
    firstPartyCookies: cookies.filter((c) => c.firstParty).length,
    thirdPartyCookies: cookies.filter((c) => !c.firstParty).length,
    persistentCookies: cookies.filter((c) => c.expires).length,
    failedRequests: requests.filter((r) => r.outcome === "failed").length,
    refusedRequests: requests.filter((r) => r.outcome === "blocked").length,
  };
}

export const CATEGORY_PLAIN: Record<string, string> = {
  analytics: "Measures how people use the site",
  advertising: "Associated with advertising",
  "tag-manager": "Loads other scripts on the site's behalf",
  "session-replay": "Associated with recording visits for later replay",
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Plain-English headline. Describes observations only; never judges them. */
export function headline(s: ReportSummary): string {
  if (s.requests === 0)
    return `No third-party requests were observed while ${s.origin} loaded. This does not prove none are ever made.`;
  const base = `While loading, ${s.origin} made ${plural(s.requests, "third-party request")} to ${plural(s.domains.length, "domain")}.`;
  if (s.recognizedDomains === 0)
    return `${base} None matched a known signature, so what these destinations are used for is not established.`;
  if (s.unknownDomains === 0) return `${base} All matched a known signature.`;
  return `${base} ${plural(s.recognizedDomains, "domain")} matched a known signature; for ${s.unknownDomains}, the purpose is not established.`;
}
