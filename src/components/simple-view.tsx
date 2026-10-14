import type { ScanReport } from "@/scanner/types";
import {
  CATEGORY_PLAIN,
  headline,
  summarize,
  type DomainSummary,
} from "@/report/summary";
import { EvidenceLabel } from "@/components/evidence";

const MAX_DOMAINS_SHOWN = 12;

const SIMPLE_EXPLANATION = {
  observed:
    "The browser contacted an address a known rule treats as data collection. Whether data arrived is not established.",
  inferred:
    "A file from a known service was requested. This does not show that data was sent.",
  unknown:
    "No known rule explains this address, so its purpose is not established. That is neither a sign of harm nor of tracking.",
} as const;

function DomainRow({ domain }: { domain: DomainSummary }) {
  const kind = domain.classifications[0]!;
  return (
    <li>
      <div className="list-title-row">
        <strong>{domain.domain}</strong>
        {domain.classifications.map((c) => (
          <EvidenceLabel key={c} kind={c} />
        ))}
      </div>
      <p className="item-meta">
        {domain.requests} {domain.requests === 1 ? "request" : "requests"}
        {domain.technologies.length > 0 &&
          ` · ${domain.technologies.join(", ")}`}
      </p>
      <p className="item-explain">{SIMPLE_EXPLANATION[kind]}</p>
    </li>
  );
}

export function SimpleView({ report }: { report: ScanReport }) {
  const s = summarize(report);
  const technologies = Array.isArray(report.technologies)
    ? report.technologies
    : [];
  const cookies = Array.isArray(report.cookies) ? report.cookies : [];
  const concerns = Array.isArray(report.concerns) ? report.concerns : [];
  const limitations = Array.isArray(report.limitations)
    ? report.limitations
    : [];
  const recognized = s.domains.filter(
    (d) => !d.classifications.every((c) => c === "unknown"),
  );
  const unknown = s.domains.filter((d) =>
    d.classifications.every((c) => c === "unknown"),
  );
  const shownUnknown = unknown.slice(0, MAX_DOMAINS_SHOWN);

  return (
    <div className="simple-view">
      <p className="simple-headline" data-testid="simple-headline">
        {headline(s)}
      </p>

      <ul className="stat-row" aria-label="Scan summary">
        <li>
          <strong>{s.requests}</strong>
          <span>third-party requests</span>
        </li>
        <li>
          <strong>{s.domains.length}</strong>
          <span>third-party domains</span>
        </li>
        <li>
          <strong>{s.technologies}</strong>
          <span>technologies detected</span>
        </li>
        <li>
          <strong>{s.cookies}</strong>
          <span>cookies</span>
        </li>
      </ul>

      <div className="interpretation-note" aria-label="Evidence guide">
        <span>
          <EvidenceLabel kind="observed" /> Seen directly
        </span>
        <span>
          <EvidenceLabel kind="inferred" /> A reasonable reading
        </span>
        <span>
          <EvidenceLabel kind="unknown" /> Not established
        </span>
      </div>

      <div className="report-grid">
        <section className="report-panel" aria-labelledby="simple-tech-heading">
          <div className="panel-heading">
            <h2 id="simple-tech-heading">Technologies detected</h2>
            <span>{technologies.length}</span>
          </div>
          {technologies.length ? (
            <ul className="evidence-list">
              {technologies.map((t, i) => (
                <li key={`${t.name}-${i}`}>
                  <div className="list-title-row">
                    <strong>{t.name}</strong>
                    <EvidenceLabel kind={t.observation} />
                  </div>
                  <p className="item-meta">
                    {CATEGORY_PLAIN[t.category] ?? t.category}
                  </p>
                  <p className="item-explain">
                    {SIMPLE_EXPLANATION[t.observation]}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">
              No known technologies were detected. This does not prove their
              absence.
            </p>
          )}
        </section>

        <section
          className="report-panel"
          aria-labelledby="simple-cookie-heading"
        >
          <div className="panel-heading">
            <h2 id="simple-cookie-heading">Cookies</h2>
            <span>{cookies.length}</span>
          </div>
          {cookies.length ? (
            <>
              <p>
                {s.firstPartyCookies} set by the site itself,{" "}
                {s.thirdPartyCookies} set by other domains.{" "}
                {s.persistentCookies}{" "}
                {s.persistentCookies === 1 ? "has" : "have"} an expiry date, so
                may stay after you close the browser.
              </p>
              <ul className="plain-list">
                {cookies.map((c, i) => (
                  <li key={`${c.domain}-${c.name}-${i}`}>
                    <strong>{c.name}</strong>{" "}
                    <span className="item-meta">
                      {c.firstParty ? "site" : "other domain"} · {c.domain}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="panel-footnote">
                A cookie&apos;s purpose is not shown by its name or flags.
                Technical view lists every attribute.
              </p>
            </>
          ) : (
            <p className="empty-state">
              No cookies were observed. This does not prove the site never sets
              cookies.
            </p>
          )}
        </section>
      </div>

      <section
        className="report-panel report-panel-wide"
        aria-labelledby="simple-dest-heading"
      >
        <div className="panel-heading">
          <h2 id="simple-dest-heading">Where the page connected</h2>
          <span>{s.domains.length}</span>
        </div>
        {s.domains.length === 0 ? (
          <p className="empty-state">
            No third-party requests were observed in this scan window.
          </p>
        ) : (
          <>
            {recognized.length > 0 && (
              <>
                <h3 className="simple-subhead">
                  Matched a known signature ({recognized.length})
                </h3>
                <ul className="evidence-list">
                  {recognized.map((d) => (
                    <DomainRow key={d.domain} domain={d} />
                  ))}
                </ul>
              </>
            )}
            {unknown.length > 0 && (
              <>
                <h3 className="simple-subhead">
                  Purpose not established ({unknown.length})
                </h3>
                <p className="table-note">
                  No known rule explains these. They may be fonts, images, a
                  content network or something else; this scan cannot say.
                </p>
                <ul className="evidence-list">
                  {shownUnknown.map((d) => (
                    <DomainRow key={d.domain} domain={d} />
                  ))}
                </ul>
                {unknown.length > shownUnknown.length && (
                  <p className="panel-footnote">
                    {unknown.length - shownUnknown.length} more domains are
                    listed in Technical view.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </section>

      {concerns.length > 0 && (
        <section
          className="report-panel report-panel-wide"
          aria-labelledby="simple-concerns-heading"
        >
          <div className="panel-heading">
            <h2 id="simple-concerns-heading">Worth noting</h2>
          </div>
          <ul className="plain-list">
            {concerns.map((c, i) => (
              <li key={i}>
                <strong>{c.title}</strong>
                <p>{c.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        className="report-panel report-panel-wide limits-panel"
        aria-labelledby="simple-limits-heading"
      >
        <div className="panel-heading">
          <h2 id="simple-limits-heading">
            What this report can&apos;t tell you
          </h2>
        </div>
        <ul className="plain-list">
          <li>
            It covers the first page load only, with no consent choice made. It
            does not show what happens after you accept or reject.
          </li>
          <li>
            A request shows that the browser contacted an address, not what was
            sent. Payloads are not inspected.
          </li>
          <li>
            It is not a legal or GDPR compliance assessment, and says nothing on
            whether the site follows the law.
          </li>
          {limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
