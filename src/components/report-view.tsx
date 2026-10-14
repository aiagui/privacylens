import type { ScanReport } from "@/scanner/types";
import { OpticalField } from "@/components/optical-field";
import { RequestJourney } from "@/components/request-journey";

function displayDate(date: string): string {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? "Time unavailable"
    : parsed.toLocaleString("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      });
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

export function EvidenceLabel({
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
    <section className="report" aria-labelledby="report-heading">
      {sample && (
        <div className="sample-banner" role="note">
          <strong>Sample data.</strong> This report illustrates
          PrivacyLens&apos;s output using bundled example data. It is not the
          result of a live scan.
        </div>
      )}
      <div className="report-focus">
        <div className="report-heading-row">
          <div>
            <p className="eyebrow">
              {sample ? "SAMPLE INSPECTION" : "WEBSITE INSPECTION"}
            </p>
            <h1 id="report-heading">
              What we observed<span>Behind the page.</span>
            </h1>
            <p className="report-target">{displayTarget(report.targetUrl)}</p>
            <p className="report-context">
              Tracking technologies, cookies and destinations — with the
              evidence to make sense of each signal.
            </p>
            <div className="report-timestamp">
              {sample ? "Example timestamp" : "Scanned"}{" "}
              {displayDate(report.scannedAt)} UTC
            </div>
          </div>
        </div>
        <div className="report-optics">
          <OpticalField />
          <p className="report-window">
            Initial page load <span>Before consent interaction</span>
          </p>
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

      <div
        className="interpretation-note"
        id="evidence-guide"
        aria-label="Evidence guide"
      >
        <span>
          <EvidenceLabel kind="observed" /> Direct browser evidence
        </span>
        <span>
          <EvidenceLabel kind="inferred" /> A supported interpretation
        </span>
        <span>
          <EvidenceLabel kind="unknown" /> Not established by this observation
        </span>
      </div>

      <details className="reading-guide">
        <summary>How to read these signals</summary>
        <div className="reading-guide-grid">
          <div>
            <strong>Evidence comes first</strong>
            <p>
              Observed means direct browser evidence. Inferred means a supported
              interpretation. Unknown means this observation cannot establish
              it; it does not prove absence.
            </p>
          </div>
          <div>
            <strong>A request is a signal</strong>
            <p>
              Timing describes when a request was initiated, not proof that a
              destination received data. Technology detection links that signal
              to a known pattern.
            </p>
          </div>
          <div>
            <strong>Consent needs context</strong>
            <p>
              A possible consent manager is a presence signal. This observation
              includes no accept or reject choice and cannot establish whether
              consent is respected.
            </p>
          </div>
        </div>
      </details>

      <div className="report-grid">
        <section className="report-panel" aria-labelledby="technology-heading">
          <div className="panel-heading">
            <h2 id="technology-heading">Detected technologies</h2>
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
            <h2 id="consent-heading">Consent signals</h2>
          </div>
          <div className="consent-state">
            <EvidenceLabel
              kind={report.cmp?.detected ? "inferred" : "unknown"}
            />
            <strong>
              {report.cmp?.detected
                ? `Possible consent manager: ${report.cmp.name ?? "unidentified"}`
                : "Consent manager not established"}
            </strong>
            {report.cmp?.evidence && <p>{report.cmp.evidence}</p>}
          </div>
          <p className="panel-footnote">
            This scan observes the page before any interaction. It does not
            accept or reject consent, and cannot determine legal compliance.
          </p>
        </section>
      </div>

      <RequestJourney requests={requests} sample={sample} />

      <section
        className="report-panel report-panel-wide"
        aria-labelledby="cookie-heading"
      >
        <div className="panel-heading">
          <h2 id="cookie-heading">Cookie inventory</h2>
          <span>{cookies.length}</span>
        </div>
        <details className="cookie-guide">
          <summary>Understand cookie attributes</summary>
          <p>
            <strong>Secure</strong> limits sending to secure connections.{" "}
            <strong>HttpOnly</strong> prevents page scripts from reading the
            cookie. <strong>SameSite</strong> controls when it accompanies
            cross-site requests. These flags describe browser handling, not the
            cookie&apos;s purpose. Cookie values are omitted.
          </p>
        </details>
        {cookies.length ? (
          <>
            <p className="table-help">
              Scroll the table horizontally to explore all attributes.
            </p>
            <div
              className="table-scroll"
              role="region"
              aria-label="Cookie attributes"
              tabIndex={0}
            >
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
                      <td>
                        {cookie.firstParty ? "First-party" : "Third-party"}
                      </td>
                      <td>{displayValue(cookie.expires)}</td>
                      <td>{cookie.secure ? "Yes" : "No"}</td>
                      <td>{cookie.httpOnly ? "Yes" : "No"}</td>
                      <td>{displayValue(cookie.sameSite)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
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
          <h2 id="network-heading">Third-party network activity</h2>
          <span>{requests.length}</span>
        </div>
        {requests.length ? (
          <>
            <p className="table-help">
              Scroll the table horizontally to explore all request details.
            </p>
            <div
              className="table-scroll"
              role="region"
              aria-label="Third-party request details"
              tabIndex={0}
            >
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
                        {request.beforeConsent
                          ? "Before interaction"
                          : "Unknown"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
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
                <h2 id="concerns-heading">Potential concerns</h2>
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
                <h2 id="limitations-heading">What remains unknown</h2>
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
