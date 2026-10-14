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
}
