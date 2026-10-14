# CI and releases

## Pull requests and main

The Quality workflow runs the publication guard, locked installation, formatting,
lint, TypeScript, unit/route/browser integration tests, production build, production
browser smoke tests and dependency audit. Secret detection separately scans the
full Git history with Gitleaks. CodeQL analyzes JavaScript/TypeScript and Actions.
Weekly runs check for dependency/security drift; Dependabot proposes npm and
Actions updates. Workflow actions are pinned to verified full commit SHAs.

Jobs run on GitHub-hosted runners with timeouts. The default token can only read
contents; CodeQL alone can write security results. Checkout credentials are not
persisted. No `pull_request_target` or automatic deployment is used. Forked pull
requests receive no deployment secrets.

Configure `main` protection to require the quality, secret detection and both
CodeQL checks, resolved conversations, an up-to-date branch, and a pull request.
Disallow force pushes/deletion and include administrators. This is a solo-maintainer
project, so do not require an unavailable second-person approval. Disable default
CodeQL setup when using the advanced workflow, to avoid duplicate analyses.

Repository configuration must be verified through GitHub after creation: a workflow
file alone does not enable branch protection or prove secret push protection is on.
Enable native secret scanning, push protection, Dependabot alerts/security updates
and private vulnerability reporting. Protect version tags against rewrites/deletion.

## Chromium sandbox tests

Chromium's process sandbox needs unprivileged user namespaces. GitHub's Ubuntu
24.04 runners block them by default (`kernel.apparmor_restrict_unprivileged_userns=1`),
so Chromium cannot start its sandbox there. The scanner **fails closed** in that
situation: it refuses to scan, and only the explicit `--unsafe-no-sandbox` flag
runs without the sandbox.

How CI handles it, and what it deliberately does not do:

- **The default Quality job keeps the runner's stock restrictions.** Sandbox-dependent
  tests are reported as skipped, and a notice in the log says so. Scans in other
  tests there run with the sandbox explicitly off, because they validate network
  isolation, not the sandbox.
- **The "Chromium sandbox tests" job** runs `npm run test:sandbox` on `ubuntu-24.04`
  (pinned: the profile syntax targets 24.04, `ubuntu-latest` moves to 26.04 in
  November 2026 and 22.04 images are being retired). It grants the user-namespace
  permission to Playwright's Chromium binaries only, through an AppArmor profile,
  and asserts that the host-wide setting is still `1`. It sets
  `PRIVACYLENS_REQUIRE_SANDBOX=1`, so if the sandbox cannot start the job fails
  instead of skipping. Every scanner and CLI test runs with the sandbox on there.
- It does not lower the host-wide sysctl, does not use `--no-sandbox`, and does not
  weaken the production CLI, whose behavior is unchanged: sandbox on, fail closed.
- Honest limit: GitHub-hosted runners give every step passwordless `sudo`, so
  contributor-controlled test code could change the VM regardless. The boundary is
  the ephemeral runner (read-only token, no secrets), not these job settings. The
  narrow profile avoids making the exception broader than it needs to be, and
  keeps the common job unchanged.

| Test                                           | Needs                                                                                     | Where it runs                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `tests/sandbox.test.ts` "fail closed"          | nothing (mocked launch)                                                                   | everywhere                                              |
| `tests/sandbox.test.ts` "real sandbox"         | unprivileged user namespaces so Chromium's sandbox starts                                 | sandbox job (required); skipped elsewhere with a notice |
| `tests/scan-live.test.ts`, `tests/cli.test.ts` | Chromium; sandbox on where available                                                      | everywhere; with the sandbox in the sandbox job         |
| WebRTC UDP test in `tests/scan-live.test.ts`   | loopback UDP, Chromium sending STUN; skipped with a notice if the control sees no traffic | everywhere it can                                       |
| Memory and process-tree tests                  | POSIX `ps` (macOS, Linux); not Windows                                                    | everywhere with `ps`                                    |

To run them locally: `PRIVACYLENS_REQUIRE_SANDBOX=1 npm run test:sandbox`. On a
Linux machine with the same restriction, an AppArmor profile like the one in the
workflow, or `sysctl kernel.apparmor_restrict_unprivileged_userns=0` for your own
machine, lets the sandbox start. The job result only enforces anything once it is
listed as a required check in branch protection.

## Source releases

The Release workflow is manually dispatched from `main` with a semantic version
such as `v0.1.0`. It reuses the quality and secret jobs and waits for CodeQL on the
same commit before a separate publish job can write contents. It refuses an
existing release/tag. The archive is created from tracked source at that exact
commit and includes a SHA-256 checksum. It excludes dependencies, build output,
local configuration and history. Use the release notes and commit identity to
review the result.

Manual dispatch is the maintainer's release action; pushing a tag alone does not
publish. No release has to be created to initialize this repository. No application
hosting, npm publication or production scanning deployment is configured. Choose
and review that target before adding deployment credentials or OIDC permissions.
