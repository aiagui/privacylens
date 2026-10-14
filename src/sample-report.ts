import type { ScanReport } from "./scanner/types";

// Bundled, deterministic example data for the public "sample report" page.
// It is never produced by scanning anything and must never be swapped for
// data from a real scan: tests/sample-report.test.ts guards the target
// domain stays on the IETF-reserved "example" TLD (RFC 2606) for exactly
// this reason.
export const SAMPLE_REPORT: ScanReport = {
  targetUrl: "https://sample-shop.example",
  scannedAt: "2026-10-01T09:14:00.000Z",
  status: "completed",
  technologies: [
    {
      name: "Google Tag Manager",
      category: "tag-manager",
      observation: "inferred",
      evidence: [
        "Resource requested from https://www.googletagmanager.com (blocked if outside fixture)",
      ],
    },
    {
      name: "Google Analytics",
      category: "analytics",
      observation: "observed",
      evidence: [
        "Tracking request initiated to https://www.google-analytics.com (blocked by fixture policy)",
      ],
    },
    {
      name: "Meta Pixel",
      category: "advertising",
      observation: "observed",
      evidence: [
        "Tracking request initiated to https://www.facebook.com (blocked by fixture policy)",
      ],
    },
    {
      name: "Microsoft Clarity",
      category: "session-replay",
      observation: "inferred",
      evidence: [
        "Resource requested from https://www.clarity.ms (blocked if outside fixture)",
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
    },
    {
      url: "https://www.google-analytics.com",
      domain: "www.google-analytics.com",
      technology: "Google Analytics",
      timeMs: 341,
      beforeConsent: true,
      resourceType: "fetch",
    },
    {
      url: "https://www.facebook.com",
      domain: "www.facebook.com",
      technology: "Meta Pixel",
      timeMs: 398,
      beforeConsent: true,
      resourceType: "fetch",
    },
    {
      url: "https://www.clarity.ms",
      domain: "www.clarity.ms",
      technology: "Microsoft Clarity",
      timeMs: 455,
      beforeConsent: true,
      resourceType: "script",
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
