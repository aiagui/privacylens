# Contributing

Open a focused pull request against `main`. Describe the behavior and its privacy
implications, use deterministic fixtures, and add regression tests for changes.
Run npm run check and the secret scan described in docs/development.md before requesting review.

Keep presentation separate from browser collection and use the shared report
contract in `src/scanner/types.ts`. Avoid speculative services and dependencies.
Substantial architecture changes need a documented design before implementation.

Only product source, tests, public build configuration and technical documentation
belong in this repository. Never commit personal instructions, local settings,
logs, real scan captures, credentials or internal operational records. `.public-files`
is the reviewed publication inventory. Adding a file requires an intentional
inventory update and content review. The publication guard is a path/content
check, not proof that a change is safe; review diffs and run secret detection too.

Require quality and security checks and resolve review conversations before
merging. The repository has one maintainer, so a second reviewer is welcome but
not represented as an enforced guarantee. Security-sensitive changes should
receive independent review when possible. Never enable arbitrary URL scanning
without an isolated worker and tested infrastructure egress restrictions.
