import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { ReportImport } from "@/components/report-import";

export const metadata: Metadata = {
  title: "Open a report — PrivacyLens",
  description:
    "Open a JSON report from the PrivacyLens command-line scanner. The file is read in your browser and never uploaded.",
};

export default function ImportPage() {
  return (
    <div className="site-shell">
      <SiteHeader current="import" />
      <main id="main-content" tabIndex={-1}>
        <ReportImport />
      </main>
      <SiteFooter note="Reports you open stay in your browser." />
    </div>
  );
}
