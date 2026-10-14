# Architecture

## Scope and boundaries

The application is a small Next.js/React project with strict TypeScript. The
current scope needs one application rather than a monorepo or microservices.

1. `src/app` renders the preview and sample pages. `/api/scan` always returns 503.
2. `src/components/report-view.tsx` renders escaped React text and imports the
   canonical `ScanReport` contract from `src/scanner/types.ts`.
3. `src/scanner/detectors.ts` classifies known signatures and reduces destinations
   to origins. A requested script alone does not establish a tracking request, and
   endpoint patterns match whole path segments, so ordinary pages such as
   `/trending` or `/events/123` on a recognized vendor host are not reported as
   collection requests. Vendors without a path pattern (e.g. TikTok, Plausible) are
   still gated only by the generic endpoint list, so the signature list remains
   heuristic and incomplete.
4. `src/scanner/scan-fixture.ts` collects browser initiation evidence from a
   caller-owned loopback HTTP fixture. External requests and redirects are blocked.
5. `src/scanner/signatures.ts` holds versioned tracker signatures; see
   [signatures](signatures.md) for classifications and contribution rules.
6. `src/scanner/dev-fixtures.ts` owns fixed HTML, starts its own loopback server and
   selects fixtures by exact own-property IDs. No request controls the destination.

The sample report imports only types from the collector and never starts a
browser. UI modules do not import the Playwright runtime. Collection, detection
and presentation share one report model instead of maintaining competing shapes.

## Data handling

Reports contain cookie names/attributes, destination origins, relative timing and
bounded evidence. They omit cookie values, URL paths/query strings, authorization
headers and payloads. No database, analytics, account system or persistence is
configured. Sample data is synthetic and targets a reserved `.example` domain.

## Local CLI scanner (v0.1.0 in development)

`npm run scan -- <url>` scans one website with headless Chromium on the user's own
machine and prints a `ScanReport` as JSON. It is a separate entry point
(`src/cli/privacylens.ts`, run with Node's built-in type stripping; relative
imports in shared modules therefore carry `.ts` extensions). The web application
does not import it, and `POST /api/scan` still returns 503.

- **Egress filter.** `src/scanner/egress-proxy.ts` is a loopback forward proxy with
  per-run credentials and the browser's only route to the network. It resolves
  names itself, refuses the connection if any answer is non-public (`ip-policy.ts`:
  loopback, private, link-local and metadata, CGNAT, multicast, unique-local,
  IPv4-mapped and transition ranges), then connects to the exact address it
  validated, so DNS rebinding has no gap to use. Redirects, subresources, frames,
  beacons and WebSockets each open a checked connection. It enforces connection,
  byte, connect and idle limits.
- **Collector.** `src/scanner/scan-live.ts` records requests the browser starts,
  their outcome (`completed`, `failed` or `blocked`), cookie names and attributes,
  and consent-manager selectors, then classifies them with the existing signatures.
  A refused request is never used as evidence about its destination. `failed`
  means the browser reported failure; the request may still have reached the
  server (for example a cross-origin response the browser blocked).
- **Provenance.** Reports carry scanner, browser and signature-set versions,
  requested and final origins, time budgets and the filter's counts, so a result
  can be reproduced and interpreted.
- **Reproducible tests.** Real Chromium scans a hostile fixture page that tries
  fetch, images, iframes, beacons, WebSockets, IPv6 and metadata addresses and
  redirects; the test counts raw TCP connections to an internal server and requires
  zero. Proxy tests drive raw sockets for rebinding, mixed DNS answers, malformed
  requests and limits. The CLI is tested as a real process.

Limits. This is a convenience safeguard for people scanning sites they choose on
their own machine. It is **not** infrastructure isolation: a flaw in the proxy,
the browser or the operating system could defeat it, and a compromised browser
shares the user's machine. The command line accepts no option to allow private
addresses; only the library API used by tests can. It does not yet cover consent
interaction, and one headless visit can differ from what a real visitor sees.
Not verified: WebRTC and QUIC are disabled by browser flags but have no dedicated
test; behavior on Windows and behind a corporate proxy is untested.

## Decision: keep live scanning disabled

Application-level DNS and IP validation cannot prevent all SSRF or DNS rebinding.
Public scanning requires a separate, disposable browser worker with network
policy enforced outside the application process. Before changing the current
503 boundary, specify queues, authentication, quotas, time/memory/process limits,
IPv4/IPv6 egress rules, redirect policy, logging minimization and retention; prove
the boundary through adversarial integration tests.

`validatePublicUrl` is unused defense-in-depth scaffolding, not permission to
launch a browser. No environment flag enables public scanning.
