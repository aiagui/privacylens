import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportView } from "../src/components/report-view";
import { SAMPLE_REPORT } from "../src/sample-report";
import { headline, summarize } from "../src/report/summary";
import { validateReport } from "../src/report/validate";
import type { ScanReport } from "../src/scanner/types";

function clone(): ScanReport {
  return JSON.parse(JSON.stringify(SAMPLE_REPORT)) as ScanReport;
}

/** A realistic CLI report: several destinations, none recognized. */
function unknownOnly(): ScanReport {
  const r = clone();
  r.technologies = [];
  r.cmp = { detected: false };
  r.thirdPartyRequests = [
    "cdn.one.example",
    "img.two.example",
    "x.three.example",
  ].flatMap((domain, i) => [
    {
      url: `https://${domain}`,
      domain,
      timeMs: 100 + i * 40,
      beforeConsent: true as const,
      resourceType: i === 1 ? "image" : "script",
      classification: "unknown" as const,
      outcome: "completed" as const,
    },
    {
      url: `https://${domain}`,
      domain,
      timeMs: 300 + i,
      beforeConsent: true as const,
      resourceType: "fetch",
      classification: "unknown" as const,
      outcome: "failed" as const,
    },
  ]);
  return r;
}

function empty(): ScanReport {
  const r = clone();
  r.technologies = [];
  r.cookies = [];
  r.thirdPartyRequests = [];
  r.concerns = [];
  return r;
}

const FIXTURES: [string, () => ScanReport][] = [
  ["sample", clone],
  ["unknown-only", unknownOnly],
  ["empty", empty],
];

function panel(html: string, id: "simple" | "technical"): string {
  const start = html.indexOf(`id="panel-${id}"`);
  const other = html.indexOf(
    `id="panel-${id === "simple" ? "technical" : "simple"}"`,
  );
  return id === "simple" ? html.slice(start, other) : html.slice(start);
}

describe("report fixtures stay valid", () => {
  for (const [name, make] of FIXTURES)
    it(`${name} passes the report validator`, () => {
      expect(validateReport(make()).ok).toBe(true);
    });
});

describe("Simple View", () => {
  it("is the default and shows a headline", () => {
    const html = renderToStaticMarkup(<ReportView report={clone()} />);
    expect(html).toMatch(/id="tab-simple"[^>]*aria-selected="true"/);
    expect(html).toMatch(/id="panel-technical"[^>]*hidden/);
    expect(html).not.toMatch(/id="panel-simple"[^>]*hidden/);
    expect(panel(html, "simple")).toContain("simple-headline");
  });

  it("describes a report of only unknown destinations without judging them", () => {
    const report = unknownOnly();
    const s = summarize(report);
    expect(s.recognizedDomains).toBe(0);
    expect(s.unknownDomains).toBe(3);
    const text = headline(s);
    expect(text).toContain("None matched a known signature");
    const simple = panel(
      renderToStaticMarkup(<ReportView report={report} />),
      "simple",
    );
    expect(simple).toContain("Purpose not established (3)");
    expect(simple).toContain("neither a sign of harm nor of tracking");
    expect(simple).not.toContain("Matched a known signature (");
    expect(simple).not.toMatch(/is harmless|are harmless|\bsafe\b/i);
  });

  it("never makes compliance or tracking claims", () => {
    for (const [, make] of FIXTURES) {
      const simple = panel(
        renderToStaticMarkup(<ReportView report={make()} />),
        "simple",
      );
      expect(simple).not.toMatch(
        /\b(GDPR[- ]compliant|compliant with|violat|illegal|complies)/i,
      );
      expect(simple).not.toMatch(/is tracking you|tracks you|spying/i);
      expect(simple).toContain("not a legal or GDPR compliance assessment");
    }
  });

  it("handles a report with nothing observed", () => {
    const simple = panel(
      renderToStaticMarkup(<ReportView report={empty()} />),
      "simple",
    );
    expect(simple).toContain("No third-party requests were observed");
    expect(simple).toContain("does not prove");
  });

  it("keeps long unknown lists bounded and points to Technical view", () => {
    const r = unknownOnly();
    r.thirdPartyRequests = Array.from({ length: 40 }, (_, i) => ({
      ...r.thirdPartyRequests[0]!,
      url: `https://d${i}.example`,
      domain: `d${i}.example`,
    }));
    const simple = panel(
      renderToStaticMarkup(<ReportView report={r} />),
      "simple",
    );
    expect(simple).toContain("28 more domains are listed in Technical view");
  });
});

describe("Technical View", () => {
  it("keeps the full inventory, signatures, provenance and cookie attributes", () => {
    const r = clone();
    r.provenance = {
      mode: "local-cli",
      scanner: { name: "privacylens", version: "0.1.0" },
      browser: { name: "chromium", version: "1.2.3", sandbox: true },
      requestedOrigin: "https://sample-shop.example",
      finalOrigin: "https://sample-shop.example",
      durationMs: 9000,
      settleMs: 3000,
      timeoutMs: 30000,
      droppedRequests: 0,
      egress: {
        allowedConnections: 3,
        blockedConnections: 0,
        limitRefusals: 0,
        failedConnections: 0,
        blockedDestinationsTruncated: false,
        blockedDestinations: [],
      },
    };
    const tech = panel(
      renderToStaticMarkup(<ReportView report={r} />),
      "technical",
    );
    for (const text of [
      "How this report was collected",
      "Cookie inventory",
      "Third-party network activity",
      "Resource type",
      "SameSite",
      "signature google-analytics",
      "Detection rules: signature set",
      "ADDRESS",
    ])
      expect(tech).toContain(text);
    expect(tech.match(/<tr\b/g)!.length).toBeGreaterThan(
      r.thirdPartyRequests.length + r.cookies.length,
    );
  });
});

describe("views never contradict each other", () => {
  function numbers(html: string, from: RegExp) {
    return [...html.matchAll(from)].map((m) => Number(m[1]));
  }
  for (const [name, make] of FIXTURES)
    it(`${name}: counts agree`, () => {
      const report = make();
      const s = summarize(report);
      const html = renderToStaticMarkup(<ReportView report={report} />);
      const simple = panel(html, "simple");
      const tech = panel(html, "technical");
      expect(
        numbers(simple, /<strong>(\d+)<\/strong><span>third-party domains/g),
      ).toEqual([s.domains.length]);
      expect(
        numbers(tech, /<strong>(\d+)<\/strong><span>third-party domains/g),
      ).toEqual([s.domains.length]);
      expect(
        numbers(simple, /<strong>(\d+)<\/strong><span>technologies/g),
      ).toEqual([s.technologies]);
      expect(
        numbers(tech, /<strong>(\d+)<\/strong><span>technologies/g),
      ).toEqual([s.technologies]);
      expect(numbers(simple, /<strong>(\d+)<\/strong><span>cookies/g)).toEqual([
        s.cookies,
      ]);
      expect(numbers(tech, /<strong>(\d+)<\/strong><span>cookies/g)).toEqual([
        s.cookies,
      ]);
      // Every domain named in Simple View is in the Technical inventory.
      for (const d of s.domains) expect(tech).toContain(d.domain);
      // Unknown in one view is unknown in the other.
      const unknownRows = report.thirdPartyRequests.filter(
        (r) => (r.classification ?? "unknown") === "unknown",
      ).length;
      expect(
        (tech.match(/evidence-unknown/g) ?? []).length,
      ).toBeGreaterThanOrEqual(unknownRows);
      if (s.unknownDomains === 0)
        expect(simple).not.toContain("Purpose not established (");
      else
        expect(simple).toContain(
          `Purpose not established (${s.unknownDomains})`,
        );
    });
});
