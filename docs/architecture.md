# Architecture

## Scope and boundaries

The application is a small Next.js/React project with strict TypeScript. The
current scope needs one application rather than a monorepo or microservices.

1. `src/app` renders the preview and sample pages. `/api/scan` always returns 503.
2. `src/components/report-view.tsx` renders escaped React text and imports the
   canonical `ScanReport` contract from `src/scanner/types.ts`.
3. `src/scanner/detectors.ts` classifies known signatures and reduces destinations
   to origins. A requested script alone does not establish a tracking request.
4. `src/scanner/scan-fixture.ts` collects browser initiation evidence from a
   caller-owned loopback HTTP fixture. External requests and redirects are blocked.
5. `src/scanner/dev-fixtures.ts` owns fixed HTML, starts its own loopback server and
   selects fixtures by exact own-property IDs. No request controls the destination.

The sample report imports only types from the collector and never starts a
browser. UI modules do not import the Playwright runtime. Collection, detection
and presentation share one report model instead of maintaining competing shapes.

## Data handling

Reports contain cookie names/attributes, destination origins, relative timing and
bounded evidence. They omit cookie values, URL paths/query strings, authorization
headers and payloads. No database, analytics, account system or persistence is
configured. Sample data is synthetic and targets a reserved `.example` domain.

## Decision: keep live scanning disabled

Application-level DNS and IP validation cannot prevent all SSRF or DNS rebinding.
Public scanning requires a separate, disposable browser worker with network
policy enforced outside the application process. Before changing the current
503 boundary, specify queues, authentication, quotas, time/memory/process limits,
IPv4/IPv6 egress rules, redirect policy, logging minimization and retention; prove
the boundary through adversarial integration tests.

`validatePublicUrl` is unused defense-in-depth scaffolding, not permission to
launch a browser. No environment flag enables public scanning.
