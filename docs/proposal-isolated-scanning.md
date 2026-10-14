# Proposal: isolated public scanning

**Status: proposal for v0.3.0 (hosted scanning). Nothing here is implemented,
deployed or approved.** The maintainer has decided the sequence: v0.1.0 is a local
CLI scanner, v0.2.0 shows real scanner results in the web interface, and hosted
scanning follows in v0.3.0. Public scanning stays disabled (`POST /api/scan`
returns 503) until this design is accepted, built and passes the acceptance tests
below. The local CLI is covered in [architecture](architecture.md) once built; it
runs on the user's own machine and is not a substitute for the isolation
described here.

## Principle

Application-level URL validation, DNS checks and Playwright interception are not
an isolation boundary. Safety must come from infrastructure that still holds if
the browser, the page or the application code is compromised.

## Components

1. **Web app** (existing Next.js). Accepts a scan request, validates syntax only,
   enqueues a job, shows status. Holds no browser and no worker credentials.
2. **Job queue** with per-client and global concurrency limits.
3. **Disposable worker.** One job per fresh microVM or container, destroyed after
   the job. Runs Chromium and the existing collector. No application secrets, no
   cloud credentials, no persistent disk, read-only root filesystem, non-root user.
4. **Egress enforcement outside the worker.** Workers sit in a subnet whose only
   route is a filtering egress layer that permits public unicast addresses and
   denies everything else for IPv4 and IPv6: loopback, RFC 1918, CGNAT, link-local,
   unique-local, multicast, and metadata endpoints (e.g. 169.254.169.254, fd00:ec2::254).
   Name resolution happens in the egress layer, which checks the address it
   actually connects to, defeating DNS rebinding and redirects to internal hosts.
5. **Result channel.** The worker returns only the `ScanReport` JSON (schema-validated,
   size-capped) through a one-way channel. Reports omit values, paths and payloads
   exactly as today.

## Gaps between this design and the current implementation (hosted scanning)

Verified against `main` when this section was written:

- **No scanning infrastructure exists.** There is no queue, worker image,
  authentication, quota or egress policy. `POST /api/scan` is a fixed 503.
- **The collector is fixture-bound.** `scanFixture(target, fixtureOrigin)` aborts
  every request outside one loopback origin and blocks all redirects. A live scan
  must let public requests proceed under infrastructure policy, so the collector
  needs a different request policy. Playwright interception would remain an
  observation aid and defense in depth, never the boundary.
- **Evidence language would change.** Today's reports say third-party requests
  were initiated but blocked before delivery, and classify them as initiation only.
  A live scan observes delivered requests and responses. Classification wording,
  limitations text and the `observed` definition in [signatures](signatures.md)
  must be reviewed so reports claim exactly what was recorded, and no more.
- **No runtime validation of reports.** `ScanReport` is a TypeScript type only.
  The "schema-validated" result channel needs a validator, whose approach and any
  dependency are open decisions.
- **`validatePublicUrl` is unused.** It would remain input validation, not a
  security control.
- **Consent interaction is not implemented.** Reports cover the initial page load
  only, and the proposal does not add consent clicking.

## Deployment options (to be decided)

| Option                                | Isolation                        | Ops burden | Notes                                                                                    |
| ------------------------------------- | -------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| A. Firecracker-style microVM per job  | Potentially strongest            | High       | Needs own host fleet or a provider offering it                                           |
| B. Managed container sandbox (gVisor) | Strong (unvalidated)             | Medium     | Egress rules must be enforced at the VPC/firewall, not in the container                  |
| C. Short-lived VM per job             | Strong (unvalidated), slow start | Medium     | Simple to reason about; higher per-scan cost and latency                                 |
| D. Run scans only locally (CLI)       | User's own machine and network   | Low        | **Chosen for v0.1.0.** No hosted risk, but inherits the user's network; see architecture |

No option is selected, and the isolation ratings above are qualitative and
unvalidated. Each option must pass the acceptance tests below to be considered. Provider, region,
budget, authentication model, retention period and CLI-versus-hosted scanning are
all open decisions for the maintainer.

## Cost model (assumptions to validate; no conclusion)

No cost conclusion is drawn here. Cost per scan is `worker runtime × price per
vCPU-second and GB-second` plus queue, storage and egress, and it depends on a
provider that has not been chosen. To decide, measure and fill in:

| Input                          | Status                                        |
| ------------------------------ | --------------------------------------------- |
| Median/p95 scan duration       | Unmeasured; measure on real, consenting sites |
| Peak memory per Chromium job   | Unmeasured                                    |
| Expected scans per month       | Unknown; depends on access model              |
| Provider prices and free tiers | Not checked; verify current published pricing |
| Fixed cost (web, queue, logs)  | Unknown until the architecture is chosen      |
| Abuse headroom and spend cap   | Open decision                                 |

Abuse is likely to matter more than baseline volume, so a hard spend cap and
quotas are part of the design regardless of the numbers.

## Abuse prevention

- Some form of access control before any scan (invite, account or other); the model is an open decision, and anonymous access would need stronger limits.
- Per-account and per-IP quotas, global concurrency cap, queue depth cap, spend alarm
  with automatic shutoff.
- Per-job budgets: wall-clock, memory, process count, request count, total bytes.
- Refuse scanning of the service itself and of targets that opt out (document a
  contact route and a robots/opt-out policy).
- Block downloads, popups beyond a limit, service workers and non-HTTP(S) schemes.

## Data handling

Retain the report only as long as needed, with user-initiated deletion; the retention period is an open decision.
Log job IDs, timing and outcome codes, never URLs with paths/queries, cookie values,
headers or bodies. No third-party analytics. Publish a plain-language privacy notice.

## Acceptance tests (all must pass before enabling)

1. From inside a worker, connections to 127.0.0.1, ::1, RFC 1918 ranges, link-local,
   IPv4-mapped IPv6 forms and cloud metadata addresses fail at the network layer.
2. A page that redirects (301/302/meta/JS) to each blocked destination never reaches it.
3. DNS rebinding: a hostname resolving to a public address, then an internal one,
   cannot reach the internal address.
4. Blocked destinations are also unreachable via WebSocket, `fetch`, `<img>`,
   service workers, WebRTC and `navigator.sendBeacon`.
5. The worker environment contains no application secrets or cloud credentials.
6. Time, memory, process, request and byte budgets terminate a hostile page and the
   worker is destroyed.
7. Quotas and concurrency limits hold under concurrent abusive load.
8. Retention deletion and log minimization are verified against real stored data.
9. A reviewer who did not build the system attempts to escape the sandbox.

## Open decisions for the maintainer (hosted scanning, v0.3.0)

Decided: a local CLI ships first (v0.1.0), then web integration (v0.2.0).
Still open for v0.3.0:

- Which option (A, B or C), hosting provider and budget ceiling.
- Invite-only vs. account-based access at launch.
- Retention period and opt-out policy.
- Runtime report validation approach.

The isolation ratings above are qualitative and unvalidated. Each option must pass
the acceptance tests above to be considered.
