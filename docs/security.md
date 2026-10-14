# Security design

## Threats and controls

| Threat                                                   | Current control                                                                                                                                                                                                         | Limit                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| SSRF and internal network access                         | Public scans disabled; exact loopback fixtures only                                                                                                                                                                     | Browser interception is not infrastructure confinement                   |
| Redirect escapes                                         | Fetch without following redirects; abort 3xx and external destinations                                                                                                                                                  | Trusted fixtures only; not a safe untrusted-web sandbox                  |
| Cookie/token disclosure                                  | No cookie values, request payloads, headers or destination paths/queries in reports                                                                                                                                     | Names/domains still need privacy review before future real collection    |
| Misleading findings                                      | Observed/inferred/unknown labels and sample banner                                                                                                                                                                      | Signatures are incomplete; no legal verdict                              |
| Resource exhaustion                                      | Request cap, browser timeout and browser cleanup                                                                                                                                                                        | No public worker capacity controls; dev server is local only             |
| UI injection                                             | React text rendering; no raw HTML reports                                                                                                                                                                               | CSP is limited to framing, objects and base URLs                         |
| Accidental publication                                   | Explicit file inventory, staged-content guard and Gitleaks                                                                                                                                                              | Human review remains necessary                                           |
| Page reaching the user's own network (local CLI)         | All browser traffic via a local egress proxy that refuses non-public addresses at connection time; hostile-page tests in real Chromium                                                                                  | Not infrastructure isolation; see architecture for what is untested      |
| Renderer exploit or page resource exhaustion (local CLI) | Chromium sandbox on by default and fail-closed; memory watchdog, download budget, JS heap cap, time limit; process tree killed after every scan                                                                         | Sandbox escape still runs as the user; Windows memory limit not enforced |
| Terminal injection from page-controlled text             | Control characters stripped from everything printed; page text never echoed                                                                                                                                             | Only the CLI paths covered by tests                                      |
| Credentials or tokens in a scanned URL or error text     | URLs reduced to origins in reports, progress and errors; credentials in URLs rejected                                                                                                                                   | The browser still loads the full URL the user typed                      |
| Malicious or malformed report file (web importer)        | Strict schema validation with unknown-field rejection and size limits; values rendered only as text; CSP limits images, connections, frames and forms to the site; no upload, storage or network use on the import path | A well-formed file can still be false; authenticity is not verified      |
| Supply-chain compromise                                  | Lockfile, pinned Actions, read-only default token, Dependabot, audit and CodeQL                                                                                                                                         | Automated scanners have false negatives                                  |

Production responds 404 to development scan routes in both the proxy and route
handler. A production browser test verifies the built application, security
headers, sample navigation and disabled endpoints. Browser contexts do not load
stored credentials; downloads and service workers are disabled for fixtures.

The app sends nosniff, no-referrer, DENY framing, restricted camera/microphone/
geolocation permissions and a partial CSP. It does not claim a complete nonce-
based script CSP or configure HTTPS/HSTS without a deployment target.

## Publication review

Review every file and diff, including lockfile URLs, fixtures and examples.
`.public-files` must match staged files exactly; symlinks, submodules, instruction
files, private settings, environment files, logs and local user paths are rejected.
This check is separate from Gitleaks history detection and GitHub native secret
scanning/push protection. Never add scanner allowlists merely to bypass a finding.

## Future production gate

An approved hosting target, enforced browser isolation, authorization, quotas,
retention policy, full deployment review and tested rollback must exist before
shipping live scans. Current release automation distributes source only.
