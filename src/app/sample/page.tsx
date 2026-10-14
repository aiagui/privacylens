import type { Metadata } from "next";
import Link from "next/link";
import { ReportView } from "@/components/report-view";
import { SAMPLE_REPORT } from "@/sample-report";

export const metadata: Metadata = {
  title: "Sample report — PrivacyLens",
  description:
    "A sample PrivacyLens report built from bundled example data, for demonstration only.",
};

export default function SampleReportPage() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="PrivacyLens home">
          <span className="brand-mark" aria-hidden="true">
            ◉
          </span>
          <span>
            privacy<span className="brand-accent">lens</span>
          </span>
        </a>
        <Link className="header-label" href="/">
          ← Back to PrivacyLens
        </Link>
      </header>

      <main id="main-content">
        <ReportView report={SAMPLE_REPORT} sample />
      </main>

      <footer className="site-footer">
        <span>PrivacyLens · Open-source website privacy inspection</span>
        <span>This page shows bundled sample data, not a live scan.</span>
      </footer>
    </div>
  );
}
