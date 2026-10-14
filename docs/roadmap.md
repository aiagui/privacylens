# Roadmap

Reflects `main` and the maintainer's agreed sequence. Only "Working now" exists
today. Everything else is planned, and nothing here is a delivery promise or a
release date.

## Working now

- Product homepage and a bundled sample report, labeled as synthetic data.
- Collector for fixed local fixtures. Public URL scanning is disabled (503).
- Versioned tracker signatures with identification criteria, fetched sources
  (unsourced claims listed as unverified), and positive and negative tests.
- Observed, inferred and unknown classifications with signature id, set version
  and a reason, shown in the report interface.
- Reports without cookie values, paths, query strings, headers or payloads.
- Quality gates, CodeQL, Gitleaks, Dependabot (ignore rules for major `@types/node`
  and TypeScript updates verified in a real run) and manually initiated source
  releases. No release has been made.

## v0.1.0: local CLI scanner

Real-world website analysis on the user's own machine, with evidence-based JSON
reports.

- Scan a user-chosen `http(s)` URL with Chromium and the existing signatures.
- All browser traffic passes through one local egress filter that resolves names
  itself and refuses private, loopback, link-local and metadata addresses, so
  redirects, DNS rebinding and page-initiated requests to the user's own network
  are blocked by default.
- JSON report with provenance (scanner, signature-set and browser versions,
  budgets, blocked-request counts) that follows the existing privacy rules.
- Automated adversarial tests, run against real Chromium, for the egress filter.
- Public web API stays disabled.

Limits to state plainly: it runs on the user's machine, so it is a convenience
safeguard for people scanning sites they choose, not the infrastructure isolation
that hosted scanning requires. Initial page load only; no consent interaction.

## v0.2.0: web report integration

Display real scanner results (JSON from the CLI) in the existing PrivacyLens
interface, without enabling server-side scanning. Needs a report validator, since
the interface would then render files it did not produce.

## v0.3.0: hosted scanning

Public URL scanning after browser isolation, network restrictions, abuse
prevention and operations are verified, following the
[proposal](proposal-isolated-scanning.md). Provider, budget, access model and
retention are open decisions.

## Later and ongoing

- **Source the unverified signature claims** (see `docs/signatures.md`).
- **Manual accessibility audit** with screen readers, other browsers and devices.
- **Consent interaction modes:** before-consent vs. after accept/reject.
- **CI additions to evaluate:** dependency review, license check, OpenSSF
  Scorecard, release provenance attestations.
- **Signature contribution process** beyond `docs/signatures.md`.
