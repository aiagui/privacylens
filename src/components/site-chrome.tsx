import Link from "next/link";
export const SOURCE_URL = "https://github.com/aiagui/privacylens";

export function LensMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="5.2">
        <ellipse cx="19" cy="24" rx="10" ry="18" transform="rotate(24 19 24)" />
        <ellipse cx="29" cy="24" rx="10" ry="18" transform="rotate(24 29 24)" />
      </g>
    </svg>
  );
}
export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="PrivacyLens home">
      <LensMark />
      <span>
        PrivacyLens<span className="brand-accent">.</span>
      </span>
    </Link>
  );
}
export function SiteHeader({ report = false }: { report?: boolean }) {
  return (
    <header className="header-surface">
      <div className="site-header container">
        <Brand />
        <nav aria-label="Main navigation">
          <Link href={report ? "/" : "/sample"}>
            {report ? "Website inspection" : "Sample report"}
          </Link>
          <a className="source-link" href={SOURCE_URL}>
            Source code <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
export function SiteFooter({ report = false }: { report?: boolean }) {
  return (
    <footer className="site-footer container">
      <Brand />
      <span>
        {report
          ? "Bundled sample data. No live scan performed."
          : "Follow the signals. Understand the evidence."}
      </span>
      <a href={SOURCE_URL}>
        Open source · MIT <span aria-hidden="true">↗</span>
      </a>
    </footer>
  );
}
