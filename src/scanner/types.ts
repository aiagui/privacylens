export type Observation = "observed" | "inferred";

export interface TechnologyFinding {
  name: string;
  category: "analytics" | "advertising" | "tag-manager" | "session-replay";
  evidence: string[];
  observation: Observation;
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
}
