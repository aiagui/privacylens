import { SIGNATURE_SET_VERSION } from "./scanner/signatures";
import { REPORT_SCHEMA_VERSION, type ScanReport } from "./scanner/types";

const signature = (id: string) => ({ id, version: SIGNATURE_SET_VERSION });

// Bundled, deterministic example data for the public "sample report" page.
// It is never produced by scanning anything and must never be swapped for
// data from a real scan: tests/sample-report.test.ts guards the target
// domain stays on the IETF-reserved "example" TLD (RFC 2606) for exactly
// this reason.
export const SAMPLE_REPORT: ScanReport = {
  schemaVersion: REPORT_SCHEMA_VERSION,
  targetUrl: "https://sample-shop.example",
  scannedAt: "2026-10-01T09:14:00.000Z",
  status: "completed",
  signatureSetVersion: SIGNATURE_SET_VERSION,
  technologies: [
    {
      name: "Google Tag Manager",
      signature: signature("google-tag-manager"),
      category: "tag-manager",
      observation: "inferred",
      evidence: [
        "Resource requested from a recognized Google Tag Manager host (google-tag-manager). This does not show that data was sent. Destination: https://www.googletagmanager.com",
      ],
    },
    {
      name: "Google Analytics",
      signature: signature("google-analytics"),
      category: "analytics",
      observation: "observed",
      evidence: [
        "Request to a recognized Google Analytics collection endpoint (google-analytics). Initiation only; payload not inspected. This endpoint pattern is not yet confirmed by vendor documentation. Destination: https://www.google-analytics.com",
      ],
    },
    {
      name: "Meta Pixel",
      signature: signature("meta-pixel"),
      category: "advertising",
      observation: "observed",
      evidence: [
        "Request to a recognized Meta Pixel collection endpoint (meta-pixel). Initiation only; payload not inspected. This endpoint pattern is not yet confirmed by vendor documentation. Destination: https://www.facebook.com",
      ],
    },
    {
      name: "Microsoft Clarity",
      signature: signature("microsoft-clarity"),
      category: "session-replay",
      observation: "inferred",
      evidence: [
        "Resource requested from a recognized Microsoft Clarity host (microsoft-clarity). This does not show that data was sent. Destination: https://www.clarity.ms",
      ],
    },
  ],
  cookies: [
    {
      name: "session_id",
      domain: "sample-shop.example",
      firstParty: true,
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      expires: "2026-11-01T09:14:00.000Z",
    },
    {
      name: "cookie_consent",
      domain: "sample-shop.example",
      firstParty: true,
      secure: true,
      httpOnly: false,
      sameSite: "Lax",
    },
    {
      name: "_ga",
      domain: ".google-analytics.com",
      firstParty: false,
      secure: true,
      httpOnly: false,
      sameSite: "None",
      expires: "2028-10-01T09:14:00.000Z",
    },
    {
      name: "_fbp",
      domain: ".facebook.com",
      firstParty: false,
      secure: true,
      httpOnly: false,
      sameSite: "None",
    },
  ],
  thirdPartyRequests: [
    {
      url: "https://www.googletagmanager.com",
      domain: "www.googletagmanager.com",
      technology: "Google Tag Manager",
      timeMs: 182,
      beforeConsent: true,
      resourceType: "script",
      classification: "inferred",
    },
    {
      url: "https://www.google-analytics.com",
      domain: "www.google-analytics.com",
      technology: "Google Analytics",
      timeMs: 341,
      beforeConsent: true,
      resourceType: "fetch",
      classification: "observed",
    },
    {
      url: "https://www.facebook.com",
      domain: "www.facebook.com",
      technology: "Meta Pixel",
      timeMs: 398,
      beforeConsent: true,
      resourceType: "fetch",
      classification: "observed",
    },
    {
      url: "https://www.clarity.ms",
      domain: "www.clarity.ms",
      technology: "Microsoft Clarity",
      timeMs: 455,
      beforeConsent: true,
      resourceType: "script",
      classification: "inferred",
    },
    {
      url: "https://cdn.assets-sample.example",
      domain: "cdn.assets-sample.example",
      timeMs: 512,
      beforeConsent: true,
      resourceType: "image",
      classification: "unknown",
    },
  ],
  cmp: {
    detected: true,
    name: "OneTrust",
    evidence: "#onetrust-banner-sdk",
  },
  concerns: [
    {
      title: "Tracking before interaction",
      detail:
        "Recognized third-party requests were initiated before any consent interaction in this example.",
      level: "attention",
    },
  ],
  limitations: [
    "This is bundled sample data for demonstration. It was not produced by scanning a live website.",
    "A real scan result covers only the initial page load and does not include any consent choice.",
    "No GDPR compliance conclusion or privacy score is ever provided, in sample or live reports.",
  ],
};
