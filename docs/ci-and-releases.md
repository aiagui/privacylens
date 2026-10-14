# CI and releases

## Pull requests and main

The Quality workflow runs the publication guard, locked installation, formatting,
lint, TypeScript, unit/route/browser integration tests, production build, production
browser smoke tests and dependency audit. Secret detection separately scans the
full Git history with Gitleaks. CodeQL analyzes JavaScript/TypeScript and Actions.
Weekly runs check for dependency/security drift; Dependabot proposes npm and
Actions updates. Workflow actions are pinned to verified full commit SHAs.

Jobs run on GitHub-hosted runners with timeouts. The Quality job relaxes the runner's
unprivileged-user-namespace restriction so Chromium's process sandbox can start and
the scanner's sandbox tests exercise it; this changes only the ephemeral VM. The default token can only read
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
