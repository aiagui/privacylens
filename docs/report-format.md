# Report format

The local scanner (`npm run scan -- <url> --out report.json`) writes one JSON
object. This page is the specification for **schema version 1**. The website opens
these files at `/import`, and any other tool can read them.

## Versioning

- Every report starts with `"schemaVersion": 1`.
- Readers accept only versions they know. A file with another version, or none, is
  refused with a message that says so; it is never partly read.
- Any change to the meaning of a field, and any field added or removed, increments
  the version. Readers reject unknown fields (see below), so there is no
  "compatible addition": a new field is a new version.
- A report is data you hold, not a signed statement. Nothing in the format proves
  who produced a file or that it is unmodified.

## What a report never contains

Cookie values, request and response bodies, headers, URL paths, query strings,
fragments and credentials. Destinations and targets are **origins** (scheme, host
and optional port), and cookies are described by name and attributes only. The
scanner enforces this when it writes; the importer enforces it again by refusing
any field or value that does not fit the shapes below.

## Structure

All fields are required unless marked optional. Strings may not contain control
characters (including newlines), zero-width characters or text-direction
overrides.

| Field                 | Type               | Meaning                                                                                        |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `schemaVersion`       | `1`                | Format version.                                                                                |
| `targetUrl`           | origin string      | The site that loaded, after HTTP redirects. No path or query.                                  |
| `scannedAt`           | UTC time           | When the scan started, like `2026-10-14T09:14:00.000Z`.                                        |
| `status`              | `"completed"`      | Only completed scans produce a report.                                                         |
| `technologies`        | list of technology | Recognized technologies and why they were recognized.                                          |
| `cookies`             | list of cookie     | Cookie names and attributes present after the initial load.                                    |
| `thirdPartyRequests`  | list of request    | Requests to other sites, in the order the browser started them.                                |
| `cmp`                 | object             | Consent-manager signal: `detected` (boolean); optional `name` and `evidence` (a CSS selector). |
| `concerns`            | list of concern    | Things worth noticing, with a `title`, a `detail` and a `level` of `info` or `attention`.      |
| `limitations`         | list of strings    | What this observation cannot establish. Always read these.                                     |
| `signatureSetVersion` | string, optional   | Version of the tracker signatures used.                                                        |
| `provenance`          | object, optional   | How the report was collected (below). Present on reports from the local scanner.               |

### technology

`name`, `category` (`analytics`, `advertising`, `tag-manager`, `session-replay`),
`evidence` (list of strings, at most 50 lines from the scanner, with a final "And N
more similar requests are not listed." line when more were seen), `observation` (`observed` or `inferred`) and an
optional `signature` (`id`, `version`) naming the rule that matched.

### cookie

`name`, `domain`, `firstParty` (boolean), `secure`, `httpOnly`, optional `expires`
(UTC time) and optional `sameSite` (`Strict`, `Lax` or `None`). A name that looks
like an identifier or secret, or that contains a control or direction character, is
written as `[REDACTED]`, and a cookie set without a name as `[unnamed]`. The
identifier check is a heuristic, and the browser can return non-ASCII cookie names
garbled, so such names may not read as the site wrote them.

### request

`url` (an http, https, ws or wss origin; WebSocket connections are recorded as
ws or wss), `domain` (the host of `url`), `timeMs` (milliseconds after navigation
started), `beforeConsent` (always `true`: reports cover the initial page load
only), `resourceType` (lowercase, like `script` or `fetch`), and optionally
`technology`, `classification` and `outcome`.

### provenance

`mode` (`"local-cli"`), `scanner` (`name`, `version`), `browser` (`name`
`"chromium"`, `version`, `sandbox`: whether Chromium's process sandbox was on),
`requestedOrigin`, `finalOrigin`, `durationMs`, `settleMs`, `timeoutMs`,
`droppedRequests` and `egress` (`allowedConnections`, `blockedConnections`,
`limitRefusals`, `failedConnections`, `blockedDestinationsTruncated` and
`blockedDestinations`, a list of `host`, `port` and `reason`).

## Evidence classes

`classification` on a request, and `observation` on a technology, say how strong
the evidence is. They are never merged or upgraded.

| Class      | Meaning                                                                  | What it does not show                  |
| ---------- | ------------------------------------------------------------------------ | -------------------------------------- |
| `observed` | A request to an endpoint a recognized signature treats as collection.    | That data arrived or what it contained |
| `inferred` | A resource from a recognized vendor was requested, such as a script.     | That any data was sent                 |
| `unknown`  | No signature explains the destination, or it was reached at an odd path. | That it is harmless, or that it tracks |

`outcome` is what the browser reported: `completed`, `failed` or `blocked`.
`blocked` means the scanner's own filter refused to contact the destination, which
is not evidence about what the destination would have received. `failed` may still
have reached the server, for example when the browser blocked a response.

## Example

```json
{
  "schemaVersion": 1,
  "targetUrl": "https://shop.example",
  "scannedAt": "2026-10-14T09:14:00.000Z",
  "status": "completed",
  "technologies": [
    {
      "name": "Matomo",
      "category": "analytics",
      "evidence": [
        "Request to a recognized Matomo collection endpoint (matomo). Initiation only; payload not inspected. Destination: https://stats.example. Outcome: completed (HTTP 204)."
      ],
      "observation": "observed",
      "signature": { "id": "matomo", "version": "2026-10-14.3" }
    }
  ],
  "cookies": [
    {
      "name": "visit_count",
      "domain": "shop.example",
      "firstParty": true,
      "secure": true,
      "httpOnly": false,
      "sameSite": "Lax"
    }
  ],
  "thirdPartyRequests": [
    {
      "url": "https://stats.example",
      "domain": "stats.example",
      "technology": "Matomo",
      "timeMs": 341,
      "beforeConsent": true,
      "resourceType": "fetch",
      "classification": "observed",
      "outcome": "completed"
    },
    {
      "url": "https://cdn.example",
      "domain": "cdn.example",
      "timeMs": 512,
      "beforeConsent": true,
      "resourceType": "script",
      "classification": "unknown",
      "outcome": "completed"
    }
  ],
  "cmp": { "detected": false },
  "concerns": [],
  "limitations": [
    "This result covers the initial page load only. No consent choice was made."
  ],
  "signatureSetVersion": "2026-10-14.3"
}
```

## Validation and limits

The importer (`src/report/validate.ts`) is the reference implementation of the
rules above. In addition it:

- accepts a file of at most 5 MB, one file at a time;
- rejects every unknown field at every level, including `__proto__`;
- limits strings (200 to 2,000 characters by field) and lists (for example 5,000
  requests, 2,000 cookies, 500 technologies);
- requires `targetUrl`, `url` and the provenance origins to be bare http(s)
  origins, times to be real UTC dates, and counts to be bounded whole numbers;
- requires a request's `domain` to be the host of its `url`, and a request that names a
  technology not to be classified `unknown`;
- builds a new object from validated fields only, never reusing the parsed file.

## How the website treats an imported file

The file is read in your browser tab with the File API, validated and displayed.
It is not uploaded, stored (no cookies, local or session storage, IndexedDB or
cache) or sent anywhere, and closing the report or the tab discards it. Every
value is rendered as plain text; none becomes a link, image, style or script. The
page's Content-Security-Policy additionally limits images, connections, frames and
forms to the site itself as a safety net; it does not restrict scripts or styles. An imported report is labeled as such,
because PrivacyLens can check its format but not its authenticity.
