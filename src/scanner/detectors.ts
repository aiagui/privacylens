import { getDomain } from "tldts";
import type { TechnologyFinding } from "./types";

interface Signature {
  name: string;
  category: TechnologyFinding["category"];
  domains: string[];
  path?: RegExp;
  scriptOnly?: boolean;
}

const signatures: Signature[] = [
  {
    name: "Google Analytics",
    category: "analytics",
    domains: ["google-analytics.com"],
    path: /\/(g\/collect|collect|analytics\.js)/i,
  },
  {
    name: "Google Tag Manager",
    category: "tag-manager",
    domains: ["googletagmanager.com"],
  },
  {
    name: "Google Ads",
    category: "advertising",
    domains: ["googleadservices.com", "doubleclick.net"],
  },
  {
    name: "Meta Pixel",
    category: "advertising",
    domains: ["facebook.com", "facebook.net"],
    path: /\/(tr|fbevents\.js)/i,
  },
  {
    name: "TikTok Pixel",
    category: "advertising",
    domains: ["tiktok.com", "tiktokcdn.com"],
  },
  {
    name: "LinkedIn Insight Tag",
    category: "advertising",
    domains: ["licdn.com", "linkedin.com"],
    path: /\/(insight|collect|px)/i,
  },
  {
    name: "Microsoft Clarity",
    category: "session-replay",
    domains: ["clarity.ms"],
  },
  {
    name: "Plausible Analytics",
    category: "analytics",
    domains: ["plausible.io"],
  },
  {
    name: "Matomo",
    category: "analytics",
    domains: [],
    path: /\/(matomo\.(js|php)|piwik\.(js|php))/i,
  },
];

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

export function detectTechnology(
  url: URL,
): Pick<TechnologyFinding, "name" | "category"> | undefined {
  const host = url.hostname.toLowerCase();
  const signature = signatures.find((candidate) => {
    const domainMatches = candidate.domains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
    if (candidate.domains.length === 0)
      return candidate.path?.test(url.pathname) ?? false;
    return (
      domainMatches && (!candidate.path || candidate.path.test(url.pathname))
    );
  });
  // Return only the public fields: `signature` also carries internal match
  // config (domains, path regex) that must never reach a ScanReport.
  return signature
    ? { name: signature.name, category: signature.category }
    : undefined;
}

export function isTrackingRequest(url: URL, resourceType: string): boolean {
  if (resourceType === "script") return false;
  return /\/(g\/collect|collect|tr|events?|pixel|px|matomo\.php|piwik\.php)/i.test(
    url.pathname,
  );
}

export function safeDestination(url: URL): string {
  // Path and query can contain identifiers or credentials. Origin is sufficient evidence of destination.
  return url.origin;
}
