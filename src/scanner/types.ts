export type Classification = "observed" | "inferred" | "unknown";
export type Observation = Exclude<Classification, "unknown">;

export interface TechnologyFinding {
  name: string;
  category: "analytics" | "advertising" | "tag-manager" | "session-replay";
  evidence: string[];
  observation: Observation;
  /** Signature that produced this finding; absent on bundled sample data. */
  signature?: { id: string; version: string };
}

export interface CookieFinding {
  name: string;
  domain: string;
  firstParty: boolean;
  expires?: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
}

export interface RequestFinding {
  url: string;
  domain: string;
  technology?: string;
  timeMs: number;
  beforeConsent: true;
  resourceType: string;
  /** Whether this destination is a recognized collection endpoint, resource, or unexplained. */
  classification?: Classification;
  /** What the browser reported for this request; absent on sample and fixture data. */
  outcome?: "completed" | "failed" | "blocked";
}

export interface ScanProvenance {
  mode: "local-cli";
  scanner: { name: string; version: string };
  browser: { name: "chromium"; version: string };
  /** Origins only: paths and queries are never recorded. */
  requestedOrigin: string;
  finalOrigin: string;
  durationMs: number;
  settleMs: number;
  timeoutMs: number;
  /** Requests beyond the recording cap; they were not listed individually. */
  droppedRequests: number;
  egress: {
    allowedConnections: number;
    blockedConnections: number;
    /** Connections turned away only because a resource limit was reached. */
    limitRefusals: number;
    /** True when more refusals happened than blockedDestinations lists. */
    blockedDestinationsTruncated: boolean;
    /** Hostname and port only. */
    blockedDestinations: { host: string; port: number; reason: string }[];
  };
}

export interface ScanReport {
  targetUrl: string;
  scannedAt: string;
  status: "completed";
  technologies: TechnologyFinding[];
  cookies: CookieFinding[];
  thirdPartyRequests: RequestFinding[];
  cmp: { detected: boolean; name?: string; evidence?: string };
  concerns: { title: string; detail: string; level: "info" | "attention" }[];
  limitations: string[];
  signatureSetVersion?: string;
  /** Present on live scans: how and with what the evidence was collected. */
  provenance?: ScanProvenance;
}
