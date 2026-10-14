import type {
  RequestFinding,
  ScanProvenance,
  ScanReport,
} from "@/scanner/types";
import { OpticalField } from "@/components/optical-field";
import { ReportTabs } from "@/components/report-tabs";
import { SimpleView } from "@/components/simple-view";
import { summarize } from "@/report/summary";
import { RequestJourney } from "@/components/request-journey";
import {
  CLASSIFICATION_EXPLANATION,
  EvidenceLabel,
  classificationOf,
} from "@/components/evidence";

export { EvidenceLabel };

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

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="empty-state">{children}</p>;
}

function outcomeLabel(outcome: RequestFinding["outcome"]): string {
  if (outcome === "completed") return "Completed";
  if (outcome === "failed") return "Failed";
  if (outcome === "blocked") return "Refused by filter";
  return "Not recorded";
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
}

function Provenance({ provenance }: { provenance: ScanProvenance }) {
  const { egress } = provenance;
  return (
    <section
      className="report-panel report-panel-wide"
      aria-labelledby="provenance-heading"
    >
      <div className="panel-heading">
        <h2 id="provenance-heading">How this report was collected</h2>
      </div>
      <dl className="fact-list">
        <div>
          <dt>Scanner</dt>
          <dd>
            {provenance.scanner.name} {provenance.scanner.version}
          </dd>
        </div>
        <div>
          <dt>Browser</dt>
          <dd>Chromium {provenance.browser.version}</dd>
        </div>
        <div>
          <dt>Browser sandbox</dt>
          <dd>
            {provenance.browser.sandbox
              ? "On"
              : "Off: this scan ran without Chromium's process sandbox"}
          </dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>
            {seconds(provenance.durationMs)} in total, with a{" "}
            {seconds(provenance.settleMs)} wait after load, under a{" "}
            {seconds(provenance.timeoutMs)} limit
          </dd>
        </div>
        {provenance.requestedOrigin !== provenance.finalOrigin && (
          <div>
            <dt>Redirected</dt>
            <dd>
              {provenance.requestedOrigin} led to {provenance.finalOrigin}
            </dd>
          </div>
        )}
        <div>
          <dt>Connections</dt>
          <dd>
            {egress.allowedConnections} allowed, {egress.blockedConnections}{" "}
            refused for safety, {egress.failedConnections} failed
            {egress.limitRefusals > 0
              ? `, ${egress.limitRefusals} turned away at the connection limit`
              : ""}
          </dd>
        </div>
        {provenance.droppedRequests > 0 && (
          <div>
            <dt>Not listed</dt>
            <dd>
              {provenance.droppedRequests} ordinary requests beyond the
              recording limit
            </dd>
          </div>
        )}
      </dl>
      {egress.blockedDestinations.length > 0 && (
        <>
          <p className="table-help">
            Destinations the scanner refused to contact. A page asking for these
            is itself something to notice, but a refused request is not evidence
            about what the destination would have received.
          </p>
          <ul className="plain-list">
            {egress.blockedDestinations.map((destination, index) => (
              <li key={`${destination.host}-${destination.port}-${index}`}>
                <code>
                  {destination.host}:{destination.port}
                </code>{" "}
                ({destination.reason})
              </li>
            ))}
          </ul>
          {egress.blockedDestinationsTruncated && (
            <p className="panel-footnote">
              More destinations were refused than are listed here.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function ReportView({
  report,
  sample = false,
  imported = false,
}: {
  report: ScanReport;
  sample?: boolean;
  /** True for a report read from a file the user chose. */
  imported?: boolean;
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
  const summary = summarize(report);

  return (
    <section className="report" aria-labelledby="report-heading">
      {sample && (
        <div className="sample-banner" role="note">
          <strong>Sample data.</strong> This report illustrates
          PrivacyLens&apos;s output using bundled example data. It is not the
          result of a live scan.
        </div>
      )}
      {imported && (
        <div className="sample-banner imported-banner" role="note">
          <strong>Imported report.</strong> This report was read from a file you
          chose, entirely in your browser. PrivacyLens checked that it matches
          the report format, but it cannot verify who produced it or that it is
          unmodified.
        </div>
      )}
      <div className="report-focus">
        <div className="report-heading-row">
          <div>
            <p className="eyebrow">
              {sample
                ? "SAMPLE INSPECTION"
                : imported
                  ? "IMPORTED INSPECTION"
                  : "WEBSITE INSPECTION"}
            </p>
            <h1 id="report-heading" tabIndex={-1}>
              What we observed<span>During page load.</span>
            </h1>
            <p className="report-target">{displayTarget(report.targetUrl)}</p>
            <div className="report-timestamp">
              {sample ? "Example timestamp" : "Scanned"}{" "}
              {displayDate(report.scannedAt)} UTC
            </div>
          </div>
        </div>
        <div className="report-optics">
          <OpticalField />
          <p className="report-window">
            Initial page load <span>No consent choice made</span>
          </p>
        </div>
      </div>

      <ReportTabs
        simple={<SimpleView report={report} />}
        technical={
          <>
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
                <strong>{summary.domains.length}</strong>
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
                <EvidenceLabel kind="unknown" /> Not established by this
                observation
              </span>
            </div>

            {report.signatureSetVersion && (
              <p className="signature-note">
                Detection rules: signature set {report.signatureSetVersion}.
                Rules are heuristics and incomplete; each finding names the rule
                that produced it.
              </p>
            )}

            <details className="reading-guide">
              <summary>How to read these signals</summary>
              <div className="reading-guide-grid">
                <div>
                  <strong>Evidence comes first</strong>
                  <p>
                    Observed means direct browser evidence. Inferred means a
                    supported interpretation. Unknown means this observation
                    cannot establish it; it does not prove absence.
                  </p>
                </div>
                <div>
                  <strong>A request is a signal</strong>
                  <p>
                    Timing describes when a request was initiated, not proof
                    that a destination received data. Technology detection links
                    that signal to a known pattern.
                  </p>
                </div>
                <div>
                  <strong>Consent needs context</strong>
                  <p>
                    A possible consent manager is a presence signal. This
                    observation includes no accept or reject choice and cannot
                    establish whether consent is respected.
                  </p>
                </div>
              </div>
            </details>

            <div className="report-grid">
              <section
                className="report-panel"
                aria-labelledby="technology-heading"
              >
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
                          <EvidenceLabel kind={technology.observation} />
                        </div>
                        {technology.category && (
                          <p className="item-meta">
                            {technology.category}
                            {technology.signature &&
                              ` · signature ${technology.signature.id}, set ${technology.signature.version}`}
                          </p>
                        )}
                        <p className="item-explain">
                          {CLASSIFICATION_EXPLANATION[technology.observation]}
                        </p>
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
                    No known technologies were detected in this observation
                    window. This does not prove their absence.
                  </EmptyState>
                )}
              </section>

              <section
                className="report-panel"
                aria-labelledby="consent-heading"
              >
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
                  This scan observes the initial page load only. It does not
                  accept or reject consent, and cannot determine legal
                  compliance.
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
                  <strong>HttpOnly</strong> prevents page scripts from reading
                  the cookie. <strong>SameSite</strong> controls when it
                  accompanies cross-site requests. These flags describe browser
                  handling, not the cookie&apos;s purpose. This report format
                  does not include cookie values.
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
                              {cookie.firstParty
                                ? "First-party"
                                : "Third-party"}
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
                  No cookies were observed in this scan. This does not prove the
                  site never sets cookies.
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
                    Scroll the table horizontally to explore all request
                    details.
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
                          <th scope="col">Resource type</th>
                          <th scope="col">Evidence</th>
                          <th scope="col">Outcome</th>
                          <th scope="col">Timing</th>
                          <th scope="col">Consent choice</th>
                        </tr>
                      </thead>
                      <tbody>
                        {requests.map((request, index) => (
                          <tr key={`${request.url}-${index}`}>
                            <th scope="row">{request.domain || request.url}</th>
                            <td>{request.technology ?? "Not identified"}</td>
                            <td>{request.resourceType || "Unknown"}</td>
                            <td>
                              <EvidenceLabel
                                kind={classificationOf(request.classification)}
                              />
                            </td>
                            <td>{outcomeLabel(request.outcome)}</td>
                            <td>
                              {typeof request.timeMs === "number"
                                ? `${Math.round(request.timeMs)} ms`
                                : "Unknown"}
                            </td>
                            <td>
                              {request.beforeConsent
                                ? "None made yet"
                                : "Not established"}
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
                This report format does not include request payloads, cookie
                values, authorization headers or URL paths and query strings.
              </p>
            </section>

            {report.provenance && <Provenance provenance={report.provenance} />}

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
          </>
        }
      />
    </section>
  );
}
