# Proposal: isolated public scanning

**Status: proposal. Nothing here is implemented, deployed or approved.** Public
scanning stays disabled (`POST /api/scan` returns 503) until this design is
accepted, built and passes the acceptance tests below.

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

## Deployment options (to be decided)

| Option                                | Isolation                      | Ops burden | Notes                                                                   |
| ------------------------------------- | ------------------------------ | ---------- | ----------------------------------------------------------------------- |
| A. Firecracker-style microVM per job  | Strongest                      | High       | Needs own host fleet or a provider offering it                          |
| B. Managed container sandbox (gVisor) | Strong                         | Medium     | Egress rules must be enforced at the VPC/firewall, not in the container |
| C. Short-lived VM per job             | Strong, slow start             | Medium     | Simple to reason about; higher per-scan cost and latency                |
| D. Run scans only locally (CLI)       | User's own machine and network | Low        | No hosted risk, but inherits the user's network; document the limits    |

Recommendation for a first hosted step: option B or C behind an **invite-only**
beta, because they can be built from commodity pieces. Option D is a useful
parallel track that needs no hosting. Provider and region are open decisions.

## Cost (unverified estimate; re-price before deciding)

Cost is dominated by browser runtime (roughly 15–30 s of one vCPU and about 1–2 GB
of memory per scan) plus a small always-on web/queue tier. At a few thousand scans
per month this is expected to be tens of dollars, rising linearly with volume; the
real risk is abuse, not baseline cost. No prices have been checked against a
provider and none should be treated as a quote.

## Abuse prevention

- Authentication (invite or account) before any scan; no anonymous scanning at launch.
- Per-account and per-IP quotas, global concurrency cap, queue depth cap, spend alarm
  with automatic shutoff.
- Per-job budgets: wall-clock, memory, process count, request count, total bytes.
- Refuse scanning of the service itself and of targets that opt out (document a
  contact route and a robots/opt-out policy).
- Block downloads, popups beyond a limit, service workers and non-HTTP(S) schemes.

## Data handling

Retain the report only as long as the user needs it (proposed: 7 days, user-deletable).
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

## Open decisions for the maintainer

- Hosting provider and budget ceiling.
- Invite-only vs. account-based access at launch.
- Retention period and opt-out policy.
- Whether to ship the local CLI (option D) first.
