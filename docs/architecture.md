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

- **Browser sandbox and limits.** Chromium's own process sandbox is on by default
  (Playwright otherwise adds `--no-sandbox`); if it cannot start, the scan fails
  and `--unsafe-no-sandbox` is the only way around it, which the report records.
  A watchdog stops the scan when the browser's processes together exceed a memory
  limit (default 2 GiB) and the proxy stops it at a download budget (100 MiB); the
  page's JavaScript heap is capped at 512 MiB. After every scan, success or
  failure, remaining browser processes are killed. The memory watchdog uses `ps`
  and is not enforced on Windows (the report says so).
- **Evidence integrity.** First-party status is judged against the page the server
  delivered, not wherever page script navigates afterwards. Requests that match a
  signature are never crowded out by a flood of ordinary ones. Chromium's
  synthetic HSTS redirects are not reported. A name that does not resolve or a
  host that refuses the connection is a failure, not a refusal. Only the proxy
  can mark a request refused: the marker is a per-run secret and is stripped from
  upstream responses. Consent-manager detection uses isolated-world locators, so
  page script cannot forge or break it. Text that reaches the terminal is stripped
  of control characters.

Limits. This is a convenience safeguard for people scanning sites they choose on
their own machine. It is **not** infrastructure isolation: a flaw in the proxy,
the browser or the operating system could defeat it, and with the sandbox on, a
browser exploit that escapes it still runs with the user's privileges. The command
line accepts no option to allow private addresses; only the library API used by
tests can. Not covered: consent interaction; HTTPS decompression bombs are bounded
by the memory watchdog, not by the byte budget (the proxy sees only compressed
bytes); any port on a public address is allowed; NAT64 destinations are refused,
so an IPv6-only network with DNS64 cannot scan IPv4-only sites; cookie-name
redaction is heuristic and cannot recognize a readable name that embeds a person's
identifier. One headless visit can differ from what a real visitor sees.

Verified by independent audit on macOS only; **not verified**: Linux and Windows
behavior of the sandbox, `ps`-based memory limits and `getaddrinfo`; PAC/WPAD
autodetection, mDNS and multicast; `preconnect` and `dns-prefetch` hints; other
Chromium versions; behind a corporate proxy.

## Opening a report in the browser (v0.2.0 in development)

`/import` opens a JSON report written by the local scanner, entirely in the
visitor's browser. The report format is specified in
[report-format.md](report-format.md) and versioned with `schemaVersion`.

- `src/report/validate.ts` is the trust boundary. It accepts exactly one schema
  version, rejects every unknown field (including `__proto__`), bounds every
  string and list, and builds a new object from validated fields; the parsed file
  is never reused. `src/report/import.ts` checks the size (5 MB) before reading,
  parses, and never throws.
- `src/components/report-import.tsx` reads the file with the File API. It makes no
  network request and uses no cookie, localStorage, sessionStorage, IndexedDB or
  cache; closing the report discards it. Errors are announced and focus moves to
  them; after a report opens, focus moves to its heading.
- The existing report components display it, labeled as imported. Every imported
  value is rendered as text, never as markup, a link, an image or a style.
- The Content-Security-Policy limits images, fonts, connections, frames, media and
  forms to the site itself, as a safety net behind that rule.

Limits. The importer checks format, not authenticity: a file can be edited, and a
well-formed report can still be false. Validation caps sizes but cannot judge
whether the evidence strings are accurate. Display relies on React's escaping; the
rendering tests and the browser test exercise hostile values, but they are not a
proof.

## Decision: keep live scanning disabled

Application-level DNS and IP validation cannot prevent all SSRF or DNS rebinding.
Public scanning requires a separate, disposable browser worker with network
policy enforced outside the application process. Before changing the current
503 boundary, specify queues, authentication, quotas, time/memory/process limits,
IPv4/IPv6 egress rules, redirect policy, logging minimization and retention; prove
the boundary through adversarial integration tests.

`validatePublicUrl` is unused defense-in-depth scaffolding, not permission to
launch a browser. No environment flag enables public scanning.
