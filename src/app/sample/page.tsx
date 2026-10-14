import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
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
      <SiteHeader report />
      <main id="main-content" tabIndex={-1}>
        <ReportView report={SAMPLE_REPORT} sample />
      </main>
      <SiteFooter report />
    </div>
  );
}
