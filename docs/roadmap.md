# Roadmap

Reflects `main` after the signature and product-interface work. Only "Working
now" exists today. Everything else is planned or undecided, and nothing here is a
delivery promise.

## Working now

- Product homepage and a bundled sample report, labeled as synthetic data.
- Collector for fixed local fixtures. Real browser scans are limited to those
  fixtures; public URL scanning is disabled (503).
- Versioned tracker signatures with identification criteria, fetched sources
  (unsourced claims listed as unverified), and positive and negative tests.
- Observed, inferred and unknown classifications with signature id, set version
  and a reason, shown in the report interface.
- Reports without cookie values, paths, query strings, headers or payloads.
- Quality gates, CodeQL, Gitleaks, Dependabot (ignore rules for major `@types/node`
  and TypeScript updates verified in a real run) and manually initiated source
  releases. No release has been made.

## Planned

1. **Source the unverified claims.** Most `collection` patterns are not yet backed
   by a fetched vendor source (see `docs/signatures.md`).
2. **Manual accessibility audit.** Automated smoke checks and contrast checks on
   key pairs exist; screen-reader, non-Chromium and real-device testing do not.
3. **Fuller "unknown" explanations.** Say more about what an inspection cannot
   establish, without implying harm.
4. **Local CLI scan** of a URL the user chooses, on their own machine (option D in
   the [proposal](proposal-isolated-scanning.md)), with clear network caveats.
   It still needs the collector's request policy redesigned; see the proposal's
   gap list.
5. **Consent interaction modes.** Before-consent vs. after accept/reject comparison.
6. **CI additions to evaluate:** dependency review on PRs, license check, OpenSSF
   Scorecard, release provenance attestations.

## Toward v0.1.0 (candidate scope; maintainer decision needed)

The release workflow can publish a source archive with checksums once a version is
authorized. What "usable" means for v0.1.0 is open:

- **A. Preview release.** Ship the current preview (sample report, fixture
  collector, disabled public scan) as a source release, labeled clearly as a
  preview that cannot scan arbitrary sites.
- **B. Local-scan release.** Add the local CLI scan first so people can inspect a
  site themselves, then release. This is more useful but needs design and tests
  for the collector change above.
- **C. Hosted-scan release.** Wait for isolated hosted scanning. This depends on
  the open infrastructure decisions below and is the slowest path.

## Unresolved decisions

- Which v0.1.0 scope above, and whether local CLI or hosted scanning comes first.
- Hosting provider, budget, access model, retention and opt-out policy.
- Runtime report validation approach.
- How outside contributors propose and review new signatures beyond
  `docs/signatures.md`.
