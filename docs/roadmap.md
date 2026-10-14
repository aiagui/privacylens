# Roadmap

Only the first section exists today. Everything else is planned or undecided.

## Working now

- Sample report page with clearly labeled synthetic data.
- Collector for fixed local fixtures with observed/inferred labels.
- Detection for a small set of known analytics, advertising and consent signatures.
- Reports without cookie values, paths, query strings, headers or payloads.
- Quality gates, CodeQL, Gitleaks, Dependabot, manual source releases.

## Planned

1. **Better evidence language.** Plain-language explanation for each finding type
   and an "unknown" section describing what the inspection could not establish.
2. **Accessibility pass.** Keyboard, screen reader and contrast audit of the report.
3. **More fixtures and signatures.** Each signature needs a documented source and a
   synthetic fixture test, including negative cases.
4. **Local CLI scan** of a URL the user chooses, on their own machine (see the
   isolated-scanning proposal, option D), with clear network caveats.
5. **Consent interaction modes.** Before-consent vs. after accept/reject comparison.
6. **CI additions** to evaluate: dependency review on PRs, license check, OpenSSF
   Scorecard, release provenance attestations.

## Unresolved decisions

- Whether and how to offer hosted public scanning ([proposal](proposal-isolated-scanning.md)).
- Hosting target and budget; retention and opt-out policy.
- Signature governance: how contributors propose and review new detections.
