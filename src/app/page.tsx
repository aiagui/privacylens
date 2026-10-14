import Link from "next/link";
import { OpticalField } from "@/components/optical-field";
import { SiteHeader, SiteFooter, SOURCE_URL } from "@/components/site-chrome";
import { EvidenceLabel } from "@/components/evidence";
import { SAMPLE_REPORT } from "@/sample-report";

export default function Home() {
  const domains = new Set(
    SAMPLE_REPORT.thirdPartyRequests.map((request) => request.domain),
  );
  return (
    <div className="site-shell">
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <div className="hero-surface">
          <section className="hero container" aria-labelledby="hero-heading">
            <div className="hero-intro">
              <p className="eyebrow">OPEN-SOURCE PRIVACY INSPECTION</p>
              <h1 id="hero-heading">
                A clearer view
                <br />
                <em>of what follows you.</em>
              </h1>
              <p className="hero-copy">
                Bring a website&apos;s third-party activity into focus.
                Understand tracking technologies, cookies and third-party
                requests through the evidence behind each finding.
              </p>
              <div className="hero-actions">
                <Link className="primary-link" href="/sample">
                  Explore a sample report <span aria-hidden="true">→</span>
                </Link>
                <a className="text-link" href="#what-we-inspect">
                  What we inspect <span aria-hidden="true">↓</span>
                </a>
              </div>
              <section className="url-preview" aria-labelledby="url-heading">
                <div className="url-preview-heading">
                  <label id="url-heading" htmlFor="website-url">
                    Inspect a website
                  </label>
                  <span>In development</span>
                </div>
                <div className="url-input-row">
                  <span aria-hidden="true">◎</span>
                  <input
                    id="website-url"
                    name="website-url"
                    type="url"
                    placeholder="https://example.com"
                    autoComplete="off"
                    aria-describedby="scan-availability"
                    disabled
                  />
                  <button
                    type="button"
                    aria-describedby="scan-availability"
                    disabled
                  >
                    Scan website <span aria-hidden="true">→</span>
                  </button>
                </div>
                <p
                  className="availability-note"
                  id="scan-availability"
                  role="note"
                >
                  Public URL scanning is not available yet. Explore the sample
                  report today.
                </p>
              </section>
            </div>
            <div className="hero-evidence">
              <OpticalField />
              <div className="field-caption preview-caption">
                <span>FROM SIGNAL TO EVIDENCE</span>
                <span>INITIAL PAGE LOAD</span>
              </div>
              <div className="report-preview">
                <div className="preview-topline">
                  <span>
                    <span className="status-dot" aria-hidden="true" />{" "}
                    Inspection report
                  </span>
                  <span className="sample-tag">SAMPLE DATA</span>
                </div>
                <h2>sample-shop.example</h2>
                <p>Initial page load · No consent choice made</p>
                <div className="preview-summary">
                  <div>
                    <strong>
                      {String(SAMPLE_REPORT.technologies.length).padStart(
                        2,
                        "0",
                      )}
                    </strong>
                    <span>Technologies</span>
                  </div>
                  <div>
                    <strong>
                      {String(SAMPLE_REPORT.cookies.length).padStart(2, "0")}
                    </strong>
                    <span>Cookies</span>
                  </div>
                  <div>
                    <strong>{String(domains.size).padStart(2, "0")}</strong>
                    <span>External domains</span>
                  </div>
                </div>
                <div className="preview-table-heading">
                  <span>TECHNOLOGY</span>
                  <span>EVIDENCE</span>
                </div>
                <ul className="preview-technologies">
                  {SAMPLE_REPORT.technologies.slice(0, 3).map((technology) => (
                    <li key={technology.name}>
                      <span>{technology.name}</span>
                      <EvidenceLabel kind={technology.observation} />
                    </li>
                  ))}
                </ul>
                <Link className="preview-link" href="/sample">
                  Read the evidence <span aria-hidden="true">→</span>
                </Link>
              </div>
              <p className="preview-footnote">Bundled example data.</p>
            </div>
          </section>
          <div className="trust-strip container">
            <span>Observed, inferred or unknown.</span>
            <span>Evidence-led findings</span>
            <span>No consent choice made</span>
            <span>Open-source code</span>
          </div>
        </div>
        <section
          className="explainer container"
          id="what-we-inspect"
          aria-labelledby="how-heading"
        >
          <p className="section-kicker">THE OBSERVATION LAYER</p>
          <div className="section-heading">
            <h2 id="how-heading">
              Follow the signals.
              <br />
              <span>Understand the evidence.</span>
            </h2>
            <p>
              Every finding names the rule behind it. Every interpretation has a
              limit. PrivacyLens keeps both in view.
            </p>
          </div>
          <div className="feature-grid">
            <article className="feature-card">
              <div className="feature-topline">
                <span className="feature-icon" aria-hidden="true">
                  ◎
                </span>
                <span>01</span>
              </div>
              <h3>Tracking technologies</h3>
              <p>
                Distinguish a loaded script from an observed tracking request.
                Understand what the evidence actually supports.
              </p>
            </article>
            <article className="feature-card">
              <div className="feature-topline">
                <span className="feature-icon" aria-hidden="true">
                  ◌
                </span>
                <span>02</span>
              </div>
              <h3>Cookie inventory</h3>
              <p>
                Explore domains, expiry and security attributes. A cookie is a
                signal to investigate, with context for what it means.
              </p>
            </article>
            <article className="feature-card">
              <div className="feature-topline">
                <span className="feature-icon" aria-hidden="true">
                  ⌘
                </span>
                <span>03</span>
              </div>
              <h3>Network activity</h3>
              <p>
                Trace third-party destinations and requests during the initial
                page load, before any consent choice is made.
              </p>
            </article>
          </div>
          <div className="boundary-note">
            <span className="section-kicker">A CLEAR BOUNDARY</span>
            <p>
              PrivacyLens reports what can be observed. It does not assign
              privacy scores or determine legal compliance.
            </p>
            <Link href="/sample#evidence-guide">
              How findings are labeled <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
        <section
          className="direction container"
          aria-labelledby="direction-heading"
        >
          <p className="section-kicker">A MORE READABLE WEB</p>
          <div className="section-heading">
            <h2 id="direction-heading">
              Built for curiosity.
              <br />
              <span>Open to everyone.</span>
            </h2>
            <p>
              For people who want to understand the sites they visit, teams who
              build them, and researchers who ask better questions.
            </p>
          </div>
          <div className="direction-body">
            <p>
              We&apos;re building toward a web where privacy signals are easy to
              inspect and explain. Next: safely isolated scanning, richer
              evidence and reports that more people can use.
            </p>
            <a
              className="text-link"
              href={SOURCE_URL + "/blob/main/CONTRIBUTING.md"}
            >
              Help bring it into focus <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
