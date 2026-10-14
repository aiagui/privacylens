import Link from "next/link";

export default function Home() {
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
        <span className="header-label">Open-source privacy inspection</span>
      </header>

      <main id="main-content">
        <section className="hero" aria-labelledby="hero-heading">
          <div className="eyebrow">
            <span className="eyebrow-dot" /> EVIDENCE, NOT ASSUMPTIONS
          </div>
          <h1 id="hero-heading">
            Know what websites <em>collect about you.</em>
          </h1>
          <p className="hero-copy">
            Explore how PrivacyLens presents trackers, cookies, and third-party
            network activity. This preview uses synthetic data; public URL
            scanning is not available.
          </p>
          <p className="availability-note" role="note">
            <strong>Preview release.</strong> Live scanning is disabled. Explore
            the sample report, or run controlled fixtures locally during
            development.
          </p>
          <p className="sample-link">
            <Link href="/sample">
              See what a report looks like, with sample data →
            </Link>
          </p>
        </section>

        <section className="explainer" aria-labelledby="how-heading">
          <div className="section-heading">
            <span className="section-kicker">THE SIGNALS</span>
            <h2 id="how-heading">A clearer view of what loads.</h2>
            <p>
              PrivacyLens reports technical evidence—not a legal compliance
              verdict.
            </p>
          </div>
          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-icon" aria-hidden="true">
                ◎
              </span>
              <h3>Trackers</h3>
              <p>
                Recognize known technologies and distinguish a loaded script
                from an observed tracking request.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-icon" aria-hidden="true">
                ▤
              </span>
              <h3>Cookies</h3>
              <p>
                Review cookie domains and security attributes without assuming
                every cookie is used for tracking.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-icon" aria-hidden="true">
                ↗
              </span>
              <h3>Network activity</h3>
              <p>
                See observable third-party destinations and whether requests
                occurred before any interaction.
              </p>
            </article>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>PrivacyLens · Open-source website privacy inspection</span>
        <span>Results are observations, not a GDPR compliance assessment.</span>
      </footer>
    </div>
  );
}
