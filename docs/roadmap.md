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
- Local CLI scanner (`npm run scan -- <url>`): live scans of a user-chosen site in
  headless Chromium behind a local egress filter, with provenance and adversarial
  tests. Unreleased; see the v0.1.0 section for what remains.
- Quality gates, CodeQL, Gitleaks, Dependabot (ignore rules for major `@types/node`
  and TypeScript updates verified in a real run) and manually initiated source
  releases. No release has been made.

## v0.1.0: local CLI scanner

Real-world website analysis on the user's own machine, with evidence-based JSON
reports. The scanner, egress filter, provenance and tests exist on `main`; the
release itself has not been made.

Remaining before a v0.1.0 release (maintainer to confirm scope):

- Dedicated tests for WebRTC and QUIC being disabled, and a check on Windows and
  behind a corporate proxy.
- Source the unverified signature claims that most affect reports.
- Human security review of the egress filter.
- Release notes that state the limits plainly: it runs on the user's machine, so it
  is a convenience safeguard, not the infrastructure isolation hosted scanning
  needs; initial page load only; no consent interaction.

The public web API stays disabled.

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
