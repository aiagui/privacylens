# Roadmap

Reflects `main` and the maintainer's agreed sequence. Only "Working now" exists
today. Everything else is planned, and nothing here is a delivery promise or a
release date.

## Working now

On `main` today. Nothing has been released or deployed.

- Product homepage and a bundled sample report, labeled as synthetic data.
- Collector for fixed local fixtures. Public URL scanning through the website is
  disabled (`POST /api/scan` returns 503), and the website does not import the
  scanner.
- Versioned tracker signatures with identification criteria, fetched sources
  (unsourced claims listed as unverified), and positive and negative tests.
- Observed, inferred and unknown classifications with signature id, set version
  and a reason, shown in the report interface.
- Reports without cookie values, paths, query strings, headers or payloads.
- **Local CLI scanner** (`npm run scan -- <url>`), run from a source checkout:
  - Headless Chromium behind a loopback egress filter that resolves names itself,
    refuses non-public addresses at connection time and dials the validated
    address; redirects, frames, beacons and WebSockets are each checked.
  - Chromium's process sandbox on by default and fail-closed; the only way around
    it is the explicit `--unsafe-no-sandbox`, which the report records.
  - Memory, download and time limits, a JavaScript heap cap, and cleanup of leftover
    browser processes after every scan.
  - Reports with provenance (scanner, browser and signature-set versions, origins,
    budgets, filter counts) and per-request outcomes (completed, failed, refused).
  - Evidence-integrity rules: first party judged by the delivered page, signature
    matches never crowded out by ordinary requests, refusals only marked by the
    proxy, isolated-world consent-manager detection, terminal-safe output.
  - Automated adversarial tests in real Chromium, proxy tests with raw sockets and
    the CLI tested as a real process.
- Two independent security audits of the scanner, both performed by AI agents
  working only from the code, with every confirmed finding fixed and covered by a
  regression test. They were not human reviews.
- CI: formatting, lint, types, tests, build and browser checks; CodeQL; Gitleaks;
  Dependabot; and a dedicated **Chromium sandbox tests** job that runs the
  sandbox-dependent tests with the sandbox on. All of these are required checks on
  `main`. Releases remain manually initiated; none has been made.

## v0.1.0: local CLI scanner

Real-world website analysis on the user's own machine, with evidence-based JSON
reports. The functionality above is integrated; what is left is confidence,
documentation and the release decision.

Remaining before a v0.1.0 release (maintainer to confirm scope):

- **Human security review** of the egress filter and collector. Both audits so far
  were AI agents.
- **Platform coverage.** Verified on macOS and on one Linux CI image. Not verified:
  Linux outside CI, Windows (where the memory limit is not enforced), and behind a
  corporate proxy. Also untested: PAC/WPAD autodetection, mDNS and multicast,
  `preconnect` and `dns-prefetch` hints, and Chromium versions other than the one
  Playwright installs.
- **Source the unverified signature claims** that most affect reports; most
  `collection` patterns are still unsourced (see `docs/signatures.md`).
- **Document the report JSON format.** The `ScanReport` type is the only
  description today, and v0.2.0 needs it.
- **Decide distribution.** For now the scanner runs from a source checkout; there
  is no npm package or installer.
- **Release notes that state the limits plainly:** it runs on the user's machine,
  so it is a convenience safeguard, not the infrastructure isolation hosted
  scanning needs; a browser exploit that escapes the sandbox still runs as the
  user; initial page load only and no consent interaction; any port on a public
  address is allowed; NAT64 destinations are refused; HTTPS decompression bombs are
  bounded by the memory watchdog, not the byte budget; cookie-name redaction is
  heuristic.
- A maintainer-authorized release through the manual release workflow.

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
