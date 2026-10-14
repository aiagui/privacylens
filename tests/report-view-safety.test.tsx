import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportView } from "../src/components/report-view";
import { SAMPLE_REPORT } from "../src/sample-report";
import { validateReport } from "../src/report/validate";

const HOSTILE = [
  '<img src="https://evil.example/pixel.png" onerror="window.__pwned=1">',
  "<script>window.__pwned = 1</script>",
  '"><svg onload=window.__pwned=1>',
  "javascript:window.__pwned=1",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "[click](https://evil.example/)",
  "https://evil.example/track?id=1",
  "{{constructor.constructor('alert(1)')()}}",
  "&lt;b&gt; &amp; &#x3c;i&#x3e; ${7*7}",
];

/** A report that passes validation while carrying hostile text in every free-text field. */
function hostileReport() {
  const draft = JSON.parse(
    JSON.stringify(SAMPLE_REPORT),
  ) as typeof SAMPLE_REPORT;
  let n = 0;
  const next = () => HOSTILE[n++ % HOSTILE.length]!;
  for (const t of draft.technologies) {
    t.name = next();
    t.evidence = [next(), next()];
  }
  for (const c of draft.cookies) c.name = next();
  for (const r of draft.thirdPartyRequests) r.technology = next();
  draft.cmp = { detected: true, name: next(), evidence: next() };
  draft.concerns = [{ title: next(), detail: next(), level: "attention" }];
  draft.limitations = [next(), next()];
  draft.provenance = {
    mode: "local-cli",
    scanner: { name: "privacylens", version: "0.1.0" },
    browser: { name: "chromium", version: "1.2.3", sandbox: false },
    requestedOrigin: "https://evil.example",
    finalOrigin: "https://other.example",
    durationMs: 1,
    settleMs: 1,
    timeoutMs: 1,
    droppedRequests: 3,
    egress: {
      allowedConnections: 1,
      blockedConnections: 1,
      limitRefusals: 1,
      failedConnections: 1,
      blockedDestinationsTruncated: true,
      blockedDestinations: [
        { host: "127.0.0.1", port: 80, reason: "<img src=x onerror=1>" },
      ],
    },
  };
  const result = validateReport(draft);
  if (!result.ok)
    throw new Error(
      `fixture should validate: ${JSON.stringify(result.issues)}`,
    );
  return result.report;
}

describe("imported report rendering", () => {
  const html = renderToStaticMarkup(
    <ReportView report={hostileReport()} imported />,
  );

  it("contains the hostile strings only as escaped text", () => {
    expect(html).toContain("&lt;img src=");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<svg\b[^>]*onload/i);
    expect(html).not.toMatch(
      /<iframe|<object|<embed|<form|<style|<link|<meta/i,
    );
  });

  it("creates no attribute from imported data", () => {
    // React escapes "<" and ">" in text, so every real tag is a genuine tag.
    // Look only inside tags: the hostile text legitimately contains " src=".
    const tags = [...html.matchAll(/<([a-zA-Z][^>]*)>/g)].map((m) => m[1]!);
    expect(tags.length).toBeGreaterThan(50);
    for (const tag of tags) {
      expect(tag, tag).not.toMatch(
        /\s(src|srcset|srcdoc|action|formaction|poster|data)=/i,
      );
      expect(tag, tag).not.toMatch(/\son[a-z]+\s*=/i);
      expect(tag, tag).not.toMatch(/\sstyle=/i);
      expect(tag, tag).not.toMatch(
        /evil\.example|pwned|javascript:|data:text/i,
      );
    }
    // The only links in a report are in-page anchors.
    const hrefs = [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^#/);
  });

  it("never turns a URL-looking value into a link or resource", () => {
    expect(html).not.toMatch(/href="https?:/i);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/href="data:/i);
    expect(html).not.toMatch(/url\(/i);
  });

  it("says plainly that the report is imported and unverified", () => {
    expect(html).toContain("Imported report.");
    expect(html).toContain("cannot verify who produced it");
  });

  it("shows the sandbox being off, not hiding it", () => {
    expect(html).toContain("Off: this scan ran without Chromium");
  });
});

describe("imported report display", () => {
  it("keeps observed, inferred and unknown visible as labels", () => {
    const view = renderToStaticMarkup(
      <ReportView report={SAMPLE_REPORT} imported />,
    );
    for (const label of ["OBSERVED", "INFERRED", "UNKNOWN"])
      expect(view).toContain(label);
  });

  it("shows outcomes, and says so when none was recorded", () => {
    const withOutcomes = JSON.parse(
      JSON.stringify(SAMPLE_REPORT),
    ) as typeof SAMPLE_REPORT;
    withOutcomes.thirdPartyRequests[0]!.outcome = "completed";
    withOutcomes.thirdPartyRequests[1]!.outcome = "failed";
    withOutcomes.thirdPartyRequests[2]!.outcome = "blocked";
    const html = renderToStaticMarkup(
      <ReportView report={withOutcomes} imported />,
    );
    expect(html).toContain("Completed");
    expect(html).toContain("Failed");
    expect(html).toContain("Refused by filter");
    expect(html).toContain("Not recorded");
  });

  it("omits the provenance panel for a report without provenance", () => {
    expect(
      renderToStaticMarkup(<ReportView report={SAMPLE_REPORT} imported />),
    ).not.toContain("How this report was collected");
  });
});
