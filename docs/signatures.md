# Tracker signatures and evidence classification

Signatures live in `src/scanner/signatures.ts` as versioned data. Detection logic
in `src/scanner/detectors.ts` only evaluates them.

## Classifications

Every assessed request is exactly one of:

| Class      | Meaning                                                                     | What it does not show                  |
| ---------- | --------------------------------------------------------------------------- | -------------------------------------- |
| `observed` | Browser initiated a request to a recognized vendor's collection endpoint.   | That data arrived or what it contained |
| `inferred` | Browser requested a recognized vendor resource, such as a script.           | That the resource sent any data        |
| `unknown`  | No signature explains the request, or a vendor host was hit at an odd path. | That it is harmless, or that it tracks |

A script request is never `observed`. A cookie is not classified by this layer.
Each result carries the signature id, the signature-set version and a plain
reason, so a reader can see why a request was classified that way.

## Adding or changing a signature

1. State the identification criteria in plain language, including what a match
   does _not_ prove.
2. Add at least one `sources` entry for each claim you can support. Fetch the page
   yourself and record the date; the page must actually mention the host or path.
   List every claim you could not source under `unverified`. A signature with no
   sources must list unverified claims, so gaps stay visible.
3. Add positive and negative `examples`. Negative examples should be ordinary
   pages on the same vendor host. Tests assert both.
4. Prefer a path rule over a bare domain wherever the domain also serves ordinary
   pages. Only domains dedicated to tooling may match on host alone.
5. Bump `SIGNATURE_SET_VERSION` and update the pinned hash in
   `tests/signatures.test.ts`. The test fails if signature content changes
   without both.
6. Use only synthetic URLs and reserved example domains in examples that are not
   the vendor's own public hosts.

## Known limits

- Several signatures still have unverified claims (see `unverified` in the file).
  The `sources` field records only pages that were fetched and found to mention
  the matched string; it is not an endorsement or complete documentation.
- Signatures are heuristics. Vendors change endpoints, and first-party or proxied
  deployments are not recognized.
- Self-hosted tools are recognized only where a file name is distinctive (Matomo).
