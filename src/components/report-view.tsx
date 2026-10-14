import type { ScanReport } from "@/scanner/types";

function displayDate(date: string): string {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? "Time unavailable"
    : parsed.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

function displayValue(value?: string | null): string {
  return value && value.trim() ? value : "Unknown";
}

function displayTarget(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "Scanned website";
  }
}

function EvidenceLabel({
  kind,
}: {
  kind: "observed" | "inferred" | "unknown";
}) {
  return (
    <span className={`evidence-label evidence-${kind}`}>
      {kind.toUpperCase()}
    </span>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="empty-state">{children}</p>;
}

export function ReportView({
  report,
  sample = false,
}: {
  report: ScanReport;
  sample?: boolean;
}) {
  const technologies = Array.isArray(report.technologies)
    ? report.technologies
    : [];
  const cookies = Array.isArray(report.cookies) ? report.cookies : [];
  const requests = Array.isArray(report.thirdPartyRequests)
    ? report.thirdPartyRequests
    : [];
  const concerns = Array.isArray(report.concerns) ? report.concerns : [];
  const limitations = Array.isArray(report.limitations)
    ? report.limitations
    : [];
  const domains = new Set(
    requests.map((request) => request.domain).filter(Boolean),
  );

  return (
    <section
      className="report"
      aria-labelledby="report-heading"
      aria-live="polite"
    >
      {sample && (
        <div className="sample-banner" role="note">
          <strong>Sample data.</strong> This report illustrates
          PrivacyLens&apos;s output using bundled example data. It is not the
          result of a live scan.
        </div>
      )}
      <div className="report-heading-row">
        <div>
          <span className="section-kicker">
            {sample ? "SAMPLE REPORT" : "SCAN REPORT"}
          </span>
          <h2 id="report-heading">What we observed</h2>
          <p className="report-target">{displayTarget(report.targetUrl)}</p>
        </div>
        <div className="report-timestamp">
          Scanned {displayDate(report.scannedAt)}
        </div>
      </div>

      <div className="summary-grid" aria-label="Scan summary">
        <div>
          <strong>{technologies.length}</strong>
          <span>technologies</span>
        </div>
        <div>
          <strong>{cookies.length}</strong>
          <span>cookies</span>
        </div>
        <div>
          <strong>{domains.size}</strong>
          <span>third-party domains</span>
        </div>
      </div>

      <div className="interpretation-note">
        <EvidenceLabel kind="observed" /> Direct browser evidence
        <EvidenceLabel kind="inferred" /> A supported interpretation
        <EvidenceLabel kind="unknown" /> Not established by this scan
      </div>

      <div className="report-grid">
        <section className="report-panel" aria-labelledby="technology-heading">
          <div className="panel-heading">
            <h3 id="technology-heading">Detected technologies</h3>
            <span>{technologies.length}</span>
          </div>
          {technologies.length ? (
            <ul className="evidence-list">
              {technologies.map((technology, index) => (
                <li key={`${technology.name}-${index}`}>
                  <div className="list-title-row">
                    <strong>{technology.name}</strong>
                    <EvidenceLabel
                      kind={
                        technology.observation === "observed"
                          ? "observed"
                          : "inferred"
                      }
                    />
                  </div>
                  {technology.category && (
                    <p className="item-meta">{technology.category}</p>
                  )}
                  {technology.evidence?.length > 0 && (
                    <ul className="evidence-details">
                      {technology.evidence.map((item, evidenceIndex) => (
                        <li key={evidenceIndex}>{item}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>
              No known technologies were detected in this observation window.
              This does not prove their absence.
            </EmptyState>
          )}
        </section>

        <section className="report-panel" aria-labelledby="consent-heading">
          <div className="panel-heading">
            <h3 id="consent-heading">Consent signals</h3>
          </div>
          <div className="consent-state">
            <EvidenceLabel
              kind={report.cmp?.detected ? "inferred" : "unknown"}
            />
            <strong>
              {report.cmp?.detected
                ? `Potential CMP: ${report.cmp.name ?? "unidentified"}`
                : "CMP presence not established"}
            </strong>
            {report.cmp?.evidence && <p>{report.cmp.evidence}</p>}
          </div>
          <p className="panel-footnote">
            This scan observes the page before any interaction. It does not
            accept or reject consent, and cannot determine legal compliance.
          </p>
        </section>
      </div>

      <section
        className="report-panel report-panel-wide"
        aria-labelledby="cookie-heading"
      >
        <div className="panel-heading">
          <h3 id="cookie-heading">Cookie inventory</h3>
          <span>{cookies.length}</span>
        </div>
        {cookies.length ? (
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">
                Cookies observed during the scan
              </caption>
              <thead>
                <tr>
                  <th scope="col">Cookie</th>
                  <th scope="col">Domain</th>
                  <th scope="col">Party</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Secure</th>
                  <th scope="col">HttpOnly</th>
                  <th scope="col">SameSite</th>
                </tr>
              </thead>
              <tbody>
                {cookies.map((cookie, index) => (
                  <tr key={`${cookie.domain}-${cookie.name}-${index}`}>
                    <th scope="row">{cookie.name}</th>
                    <td>{cookie.domain}</td>
                    <td>{cookie.firstParty ? "First-party" : "Third-party"}</td>
                    <td>{displayValue(cookie.expires)}</td>
                    <td>{cookie.secure ? "Yes" : "No"}</td>
                    <td>{cookie.httpOnly ? "Yes" : "No"}</td>
                    <td>{displayValue(cookie.sameSite)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>
            No cookies were observed in this scan. This does not prove the site
            never sets cookies.
          </EmptyState>
        )}
      </section>

      <section
        className="report-panel report-panel-wide"
        aria-labelledby="network-heading"
      >
        <div className="panel-heading">
          <h3 id="network-heading">Third-party network activity</h3>
          <span>{requests.length}</span>
        </div>
        {requests.length ? (
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">
                Third-party requests observed during the scan
              </caption>
              <thead>
                <tr>
                  <th scope="col">Destination</th>
                  <th scope="col">Technology</th>
                  <th scope="col">Timing</th>
                  <th scope="col">Consent state</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request, index) => (
                  <tr key={`${request.url}-${index}`}>
                    <th scope="row">{request.domain || request.url}</th>
                    <td>{request.technology ?? "Unknown"}</td>
                    <td>
                      {typeof request.timeMs === "number"
                        ? `${Math.round(request.timeMs)} ms`
                        : "Unknown"}
                    </td>
                    <td>
                      {request.beforeConsent ? "Before interaction" : "Unknown"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>
            No third-party requests were observed in this scan window.
          </EmptyState>
        )}
        <p className="panel-footnote">
          Sensitive payloads, session tokens, and authorization headers are not
          included in this report.
        </p>
      </section>

      {(concerns.length > 0 || limitations.length > 0) && (
        <div className="report-grid">
          {concerns.length > 0 && (
            <section
              className="report-panel"
              aria-labelledby="concerns-heading"
            >
              <div className="panel-heading">
                <h3 id="concerns-heading">Potential concerns</h3>
              </div>
              <ul className="plain-list">
                {concerns.map((concern, index) => (
                  <li key={index}>
                    <strong>{concern.title}</strong>
                    <p>{concern.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {limitations.length > 0 && (
            <section
              className="report-panel"
              aria-labelledby="limitations-heading"
            >
              <div className="panel-heading">
                <h3 id="limitations-heading">What remains unknown</h3>
              </div>
              <ul className="plain-list">
                {limitations.map((limitation, index) => (
                  <li key={index}>{limitation}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
