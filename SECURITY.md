# Security policy

This pre-release project is supported for local fixture development and sample
report exploration only. It is not supported as a public live scanning service.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/aiagui/privacylens/security/advisories/new).
Do not include exploit details, credentials or personal data in public issues.
Reports are triaged as maintainer capacity permits; no response-time guarantee
is made.

Public arbitrary-URL scans return 503. Development fixture routes return 404 in
production. Browser route interception and URL checks are development safeguards;
they are not an infrastructure isolation boundary. Never run untrusted web
content with access to internal networks or authenticated sessions.

See [security design](docs/security.md). Automated analysis and dependency audits
reduce risk but do not establish that software has no vulnerabilities.
