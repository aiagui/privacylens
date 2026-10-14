# Development and testing

Use Node.js 24 and the committed npm lockfile. `npm ci` installs the exact dependency
tree. `npm run dev` binds the development server to `127.0.0.1`; do not expose it
through a tunnel or a public interface.

Tests use synthetic HTML and loopback servers. Browser integration tests assert
that redirect destinations receive zero hits and cookie values/query strings do
not enter reports. Route tests prove production denial, fixed fixture selection
and rejection of prototype-property fixture IDs.

`npm run test:e2e` runs two scripts against the built application on an ephemeral
loopback port. The first opens it with Chromium and checks the sample report,
disabled endpoints, security headers and absence of external browser requests. The
second runs the real CLI code path against a local fixture, then imports the report
it wrote at `/import` and checks the display, error handling, keyboard use, drag
and drop, hostile content, absence of network traffic and storage, and layout on
phones. Run `npm run build` first. Where Chromium's sandbox cannot start (see
ci-and-releases.md) the fixture scan says so and runs without it.

No runtime secrets or local environment files are needed. Agent instruction file
generation is disabled in Next.js; any personal tooling configuration stays local
and untracked. For a new public file, update `.public-files`, stage it, inspect the
diff, then run the publication guard and secret scanner. CI inspects staged content
from a fresh checkout.

## Quickstart and fixture API

```sh
npm ci
npx playwright install chromium
npm run dev
```

Open http://127.0.0.1:3000. The report at /sample uses bundled synthetic data.
Outside production, GET /api/dev/scan-fixture lists fixed fixture IDs and
POST /api/dev/scan-fixture accepts {"fixtureId":"baseline"}. It never accepts a
target URL. Keep the development server bound to loopback.

## Verification

```sh
npm run check
gitleaks git --redact
```

The aggregate check runs the publication guard, formatting, lint, types, tests,
dependency audit, build and production browser checks. Stage intended files
before running the publication guard: it inspects the Git index. Scanner tests
need Chromium; on Linux use npx playwright install --with-deps chromium.

To refresh the public product screenshots, set PRIVACYLENS_SCREENSHOT_DIR to
docs/assets when running npm run test:e2e after a build. Review all the PNGs and
their metadata, then update their asset fingerprints in the publication guard.

## Project map

| Location             | Responsibility                                         |
| -------------------- | ------------------------------------------------------ |
| src/app              | Pages and thin HTTP adapters                           |
| src/components       | Product identity and report presentation               |
| src/scanner          | Collection, detection, URL policy and report contract  |
| src/sample-report.ts | Deterministic demonstration data                       |
| public               | Reviewed product assets and locally hosted font        |
| tests                | Unit, route, integration and publication regressions   |
| scripts              | Publication guard and production browser checks        |
| docs                 | Architecture, product direction, identity and security |
| .github              | CI, CodeQL, secret detection and source releases       |
