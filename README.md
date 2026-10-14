# PrivacyLens

Website privacy evidence, with clear limits.

PrivacyLens is an early open-source preview. It presents detected technologies,
cookie attributes, third-party destinations and possible consent-management
signals. Findings distinguish observed evidence, inference and unknowns.

**Public URL scanning is disabled.** The public interface shows a bundled sample
report. Developers can exercise the browser collector against fixed local
fixtures. This project is not a production scanning service and does not provide
a legal compliance verdict or privacy score.

## Run locally

Use Node.js 24 LTS and npm:

```sh
npm ci
npx playwright install chromium
npm run dev
```

Open <http://127.0.0.1:3000>. The sample report at `/sample` uses synthetic data.
Outside production, `GET /api/dev/scan-fixture` lists fixed fixture IDs and
`POST /api/dev/scan-fixture` accepts `{"fixtureId":"baseline"}`. It never accepts
a target URL. Keep the development server bound to loopback.

## Verify

```sh
npm run check:publication
npm run format:check
npm run lint
npm run typecheck
npm test
npm run audit
npm run build
npm run test:e2e
```

Scanner tests need Playwright Chromium. On Linux use
`npx playwright install --with-deps chromium`. Publication checks inspect the Git
index; stage intended files before running them. Gitleaks scans tracked history
in CI; run `gitleaks git --redact` before pushing.

## Project map

| Location               | Responsibility                                               |
| ---------------------- | ------------------------------------------------------------ |
| `src/app`              | Pages and thin HTTP adapters                                 |
| `src/components`       | Report presentation                                          |
| `src/scanner`          | Collection, detection, URL policy and shared report contract |
| `src/sample-report.ts` | Deterministic demonstration data                             |
| `tests`                | Unit, route, browser integration and publication regressions |
| `scripts`              | Publication guard and production browser smoke tests         |
| `docs`                 | Architecture, threat model and release procedure             |
| `.github`              | CI, CodeQL, secret detection and manual source releases      |

See the [roadmap](docs/roadmap.md), [isolated-scanning proposal](docs/proposal-isolated-scanning.md), [architecture](docs/architecture.md), [security boundaries](docs/security.md),
[development](docs/development.md) and [CI and releases](docs/ci-and-releases.md).
Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities
privately using [SECURITY.md](SECURITY.md).

MIT licensed; see [LICENSE](LICENSE).
