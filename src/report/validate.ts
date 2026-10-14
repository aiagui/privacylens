import {
  REPORT_SCHEMA_VERSION,
  type Classification,
  type CookieFinding,
  type RequestFinding,
  type ScanProvenance,
  type ScanReport,
  type TechnologyFinding,
} from "../scanner/types";

/**
 * Strict runtime validation of a report read from a file.
 *
 * The file is untrusted: it may be malformed, hostile or simply produced by a
 * different version. The validator therefore
 *  - accepts only the exact schema version it knows,
 *  - rejects every unknown property (at every level, including "__proto__"),
 *  - bounds the length of every string and array,
 *  - and builds a brand-new object from the validated fields; the input object
 *    is never spread, copied wholesale or returned.
 * Strings are checked for control and direction-override characters, but they
 * are still only ever rendered as text, never as markup, links or resources.
 */

export const LIMITS = {
  technologies: 500,
  evidencePerTechnology: 100,
  cookies: 2000,
  requests: 5000,
  concerns: 50,
  limitations: 100,
  blockedDestinations: 100,
  shortText: 200,
  text: 2000,
  origin: 300,
  hostname: 300,
} as const;

export interface ValidationIssue {
  /** JSON-path style location, e.g. "technologies[3].name". */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; report: ScanReport }
  | { ok: false; issues: ValidationIssue[]; truncated: boolean };

const MAX_ISSUES = 20;

class Issues {
  readonly list: ValidationIssue[] = [];
  truncated = false;
  add(path: string, message: string): void {
    if (this.list.length >= MAX_ISSUES) this.truncated = true;
    else this.list.push({ path: path || "(file)", message });
  }
  get any(): boolean {
    return this.list.length > 0 || this.truncated;
  }
}

function isUnsafeCharacter(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

/** Shows a hostile key name safely and briefly in an error message. */
function shown(text: string): string {
  const cut = [...text]
    .slice(0, 40)
    .map((c) => (isUnsafeCharacter(c.codePointAt(0) ?? 0) ? "?" : c))
    .join("");
  return JSON.stringify(text.length > 40 ? `${cut}...` : cut);
}

type Rec = Record<string, unknown>;

function record(
  issues: Issues,
  value: unknown,
  path: string,
  allowed: readonly string[],
): Rec | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.add(path, `must be an object, found ${describe(value)}`);
    return undefined;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    issues.add(path, "must be a plain object");
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      issues.add(
        path ? `${path}.${key.length > 40 ? "..." : key}` : shown(key),
        `is not a known field (unknown field ${shown(key)})`,
      );
  }
  return value as Rec;
}

const has = (rec: Rec, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(rec, key);

function text(
  issues: Issues,
  value: unknown,
  path: string,
  max: number,
  options: { min?: number; pattern?: RegExp; patternHint?: string } = {},
): string | undefined {
  if (typeof value !== "string") {
    issues.add(path, `must be a string, found ${describe(value)}`);
    return undefined;
  }
  if (value.length < (options.min ?? 0)) {
    issues.add(path, "must not be empty");
    return undefined;
  }
  if (value.length > max) {
    issues.add(path, `is too long (at most ${max} characters)`);
    return undefined;
  }
  for (const character of value) {
    if (isUnsafeCharacter(character.codePointAt(0) ?? 0)) {
      issues.add(
        path,
        "contains a control or direction-override character, which is not allowed",
      );
      return undefined;
    }
  }
  if (options.pattern && !options.pattern.test(value)) {
    issues.add(path, options.patternHint ?? "has an unexpected format");
    return undefined;
  }
  return value;
}

function bool(issues: Issues, value: unknown, path: string) {
  if (typeof value !== "boolean") {
    issues.add(path, `must be true or false, found ${describe(value)}`);
    return undefined;
  }
  return value;
}

function int(
  issues: Issues,
  value: unknown,
  path: string,
  max: number,
): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > max
  ) {
    issues.add(path, `must be a whole number from 0 to ${max}`);
    return undefined;
  }
  return value;
}

function oneOf<T extends string>(
  issues: Issues,
  value: unknown,
  path: string,
  options: readonly T[],
): T | undefined {
  if (typeof value !== "string" || !options.includes(value as T)) {
    issues.add(path, `must be one of: ${options.join(", ")}`);
    return undefined;
  }
  return value as T;
}

function list<T>(
  issues: Issues,
  value: unknown,
  path: string,
  max: number,
  each: (item: unknown, itemPath: string) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) {
    issues.add(path, `must be a list, found ${describe(value)}`);
    return undefined;
  }
  if (value.length > max) {
    issues.add(path, `has too many entries (at most ${max})`);
    return undefined;
  }
  const out: T[] = [];
  value.forEach((item, index) => {
    const parsed = each(item, `${path}[${index}]`);
    if (parsed !== undefined) out.push(parsed);
  });
  return out;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function isoDate(issues: Issues, value: unknown, path: string) {
  const parsed = text(issues, value, path, 30, {
    pattern: ISO,
    patternHint: "must be a UTC time like 2026-10-14T09:14:00.000Z",
  });
  if (parsed !== undefined && Number.isNaN(Date.parse(parsed))) {
    issues.add(path, "is not a real date");
    return undefined;
  }
  return parsed;
}

/** An http(s) origin: scheme, host and optional port, nothing else. */
function origin(issues: Issues, value: unknown, path: string) {
  const raw = text(issues, value, path, LIMITS.origin, { min: 1 });
  if (raw === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    issues.add(path, "must be an origin such as https://example.com");
    return undefined;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== raw ||
    raw.endsWith("/")
  ) {
    issues.add(
      path,
      "must be an http or https origin with no path, query, fragment or credentials",
    );
    return undefined;
  }
  return raw;
}

const HOSTNAME = /^[A-Za-z0-9.\-[\]:]{1,300}$/;
const COOKIE_DOMAIN = /^\.?[A-Za-z0-9.\-[\]:]{1,300}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const CATEGORIES = [
  "analytics",
  "advertising",
  "tag-manager",
  "session-replay",
] as const;
const CLASSES = ["observed", "inferred", "unknown"] as const;

function technology(issues: Issues, value: unknown, path: string) {
  const rec = record(issues, value, path, [
    "name",
    "category",
    "evidence",
    "observation",
    "signature",
  ]);
  if (!rec) return undefined;
  const name = text(issues, rec.name, `${path}.name`, LIMITS.shortText, {
    min: 1,
  });
  const category = oneOf(issues, rec.category, `${path}.category`, CATEGORIES);
  const evidence = list(
    issues,
    rec.evidence,
    `${path}.evidence`,
    LIMITS.evidencePerTechnology,
    (item, at) => text(issues, item, at, LIMITS.text),
  );
  const observation = oneOf(issues, rec.observation, `${path}.observation`, [
    "observed",
    "inferred",
  ] as const);
  let signature: TechnologyFinding["signature"];
  if (has(rec, "signature")) {
    const sig = record(issues, rec.signature, `${path}.signature`, [
      "id",
      "version",
    ]);
    if (sig) {
      const id = text(issues, sig.id, `${path}.signature.id`, 64, {
        pattern: TOKEN,
      });
      const version = text(
        issues,
        sig.version,
        `${path}.signature.version`,
        32,
        {
          min: 1,
          pattern: TOKEN,
        },
      );
      if (id !== undefined && version !== undefined)
        signature = { id, version };
    }
  }
  if (!name || !category || !evidence || !observation) return undefined;
  return {
    name,
    category,
    evidence,
    observation,
    ...(signature ? { signature } : {}),
  } satisfies TechnologyFinding;
}

function cookie(issues: Issues, value: unknown, path: string) {
  const rec = record(issues, value, path, [
    "name",
    "domain",
    "firstParty",
    "expires",
    "secure",
    "httpOnly",
    "sameSite",
  ]);
  if (!rec) return undefined;
  const name = text(issues, rec.name, `${path}.name`, 300, { min: 1 });
  const domain = text(issues, rec.domain, `${path}.domain`, LIMITS.hostname, {
    min: 1,
    pattern: COOKIE_DOMAIN,
    patternHint: "must be a host name",
  });
  const firstParty = bool(issues, rec.firstParty, `${path}.firstParty`);
  const secure = bool(issues, rec.secure, `${path}.secure`);
  const httpOnly = bool(issues, rec.httpOnly, `${path}.httpOnly`);
  const expires = has(rec, "expires")
    ? isoDate(issues, rec.expires, `${path}.expires`)
    : undefined;
  const sameSite = has(rec, "sameSite")
    ? oneOf(issues, rec.sameSite, `${path}.sameSite`, [
        "Strict",
        "Lax",
        "None",
      ] as const)
    : undefined;
  if (
    !name ||
    !domain ||
    firstParty === undefined ||
    secure === undefined ||
    httpOnly === undefined
  )
    return undefined;
  return {
    name,
    domain,
    firstParty,
    ...(expires !== undefined ? { expires } : {}),
    secure,
    httpOnly,
    ...(sameSite !== undefined ? { sameSite } : {}),
  } satisfies CookieFinding;
}

function request(issues: Issues, value: unknown, path: string) {
  const rec = record(issues, value, path, [
    "url",
    "domain",
    "technology",
    "timeMs",
    "beforeConsent",
    "resourceType",
    "classification",
    "outcome",
  ]);
  if (!rec) return undefined;
  const url = origin(issues, rec.url, `${path}.url`);
  const domain = text(issues, rec.domain, `${path}.domain`, LIMITS.hostname, {
    min: 1,
    pattern: HOSTNAME,
    patternHint: "must be a host name",
  });
  const technology = has(rec, "technology")
    ? text(issues, rec.technology, `${path}.technology`, LIMITS.shortText, {
        min: 1,
      })
    : undefined;
  let timeMs: number | undefined;
  if (
    typeof rec.timeMs !== "number" ||
    !Number.isFinite(rec.timeMs) ||
    rec.timeMs < 0 ||
    rec.timeMs > 86_400_000
  )
    issues.add(
      `${path}.timeMs`,
      "must be a number of milliseconds from 0 to 86400000",
    );
  else timeMs = rec.timeMs;
  if (rec.beforeConsent !== true)
    issues.add(
      `${path}.beforeConsent`,
      "must be true (reports cover the initial page load only)",
    );
  const resourceType = text(
    issues,
    rec.resourceType,
    `${path}.resourceType`,
    32,
    {
      pattern: /^[a-z][a-z-]{0,31}$/,
      patternHint: "must be a lowercase resource type such as script or fetch",
    },
  );
  const classification = has(rec, "classification")
    ? oneOf(issues, rec.classification, `${path}.classification`, CLASSES)
    : undefined;
  const outcome = has(rec, "outcome")
    ? oneOf(issues, rec.outcome, `${path}.outcome`, [
        "completed",
        "failed",
        "blocked",
      ] as const)
    : undefined;
  if (
    !url ||
    !domain ||
    timeMs === undefined ||
    rec.beforeConsent !== true ||
    !resourceType
  )
    return undefined;
  return {
    url,
    domain,
    ...(technology !== undefined ? { technology } : {}),
    timeMs,
    beforeConsent: true,
    resourceType,
    ...(classification !== undefined
      ? { classification: classification as Classification }
      : {}),
    ...(outcome !== undefined ? { outcome } : {}),
  } satisfies RequestFinding;
}

function provenance(issues: Issues, value: unknown, path: string) {
  const rec = record(issues, value, path, [
    "mode",
    "scanner",
    "browser",
    "requestedOrigin",
    "finalOrigin",
    "durationMs",
    "settleMs",
    "timeoutMs",
    "droppedRequests",
    "egress",
  ]);
  if (!rec) return undefined;
  if (rec.mode !== "local-cli")
    issues.add(`${path}.mode`, 'must be "local-cli"');
  const scannerRec = record(issues, rec.scanner, `${path}.scanner`, [
    "name",
    "version",
  ]);
  const scanner = scannerRec && {
    name: text(issues, scannerRec.name, `${path}.scanner.name`, 64, {
      min: 1,
      pattern: TOKEN,
    }),
    version: text(issues, scannerRec.version, `${path}.scanner.version`, 32, {
      min: 1,
      pattern: TOKEN,
    }),
  };
  const browserRec = record(issues, rec.browser, `${path}.browser`, [
    "name",
    "version",
    "sandbox",
  ]);
  const browser = browserRec && {
    name: browserRec.name === "chromium" ? ("chromium" as const) : undefined,
    version: text(issues, browserRec.version, `${path}.browser.version`, 64, {
      min: 1,
      pattern: TOKEN,
    }),
    sandbox: bool(issues, browserRec.sandbox, `${path}.browser.sandbox`),
  };
  if (browserRec && browser?.name === undefined)
    issues.add(`${path}.browser.name`, 'must be "chromium"');
  const requestedOrigin = origin(
    issues,
    rec.requestedOrigin,
    `${path}.requestedOrigin`,
  );
  const finalOrigin = origin(issues, rec.finalOrigin, `${path}.finalOrigin`);
  const durationMs = int(
    issues,
    rec.durationMs,
    `${path}.durationMs`,
    86_400_000,
  );
  const settleMs = int(issues, rec.settleMs, `${path}.settleMs`, 3_600_000);
  const timeoutMs = int(issues, rec.timeoutMs, `${path}.timeoutMs`, 3_600_000);
  const droppedRequests = int(
    issues,
    rec.droppedRequests,
    `${path}.droppedRequests`,
    1_000_000,
  );
  const egressRec = record(issues, rec.egress, `${path}.egress`, [
    "allowedConnections",
    "blockedConnections",
    "limitRefusals",
    "failedConnections",
    "blockedDestinationsTruncated",
    "blockedDestinations",
  ]);
  const egress = egressRec && {
    allowedConnections: int(
      issues,
      egressRec.allowedConnections,
      `${path}.egress.allowedConnections`,
      1_000_000,
    ),
    blockedConnections: int(
      issues,
      egressRec.blockedConnections,
      `${path}.egress.blockedConnections`,
      1_000_000,
    ),
    limitRefusals: int(
      issues,
      egressRec.limitRefusals,
      `${path}.egress.limitRefusals`,
      1_000_000,
    ),
    failedConnections: int(
      issues,
      egressRec.failedConnections,
      `${path}.egress.failedConnections`,
      1_000_000,
    ),
    blockedDestinationsTruncated: bool(
      issues,
      egressRec.blockedDestinationsTruncated,
      `${path}.egress.blockedDestinationsTruncated`,
    ),
    blockedDestinations: list(
      issues,
      egressRec.blockedDestinations,
      `${path}.egress.blockedDestinations`,
      LIMITS.blockedDestinations,
      (item, at) => {
        const dest = record(issues, item, at, ["host", "port", "reason"]);
        if (!dest) return undefined;
        const host = text(issues, dest.host, `${at}.host`, LIMITS.hostname, {
          pattern: HOSTNAME,
        });
        const port = int(issues, dest.port, `${at}.port`, 65_535);
        const reason = text(issues, dest.reason, `${at}.reason`, 64, {
          min: 1,
        });
        return host !== undefined && port !== undefined && reason !== undefined
          ? { host, port, reason }
          : undefined;
      },
    ),
  };
  if (
    rec.mode !== "local-cli" ||
    !scanner?.name ||
    !scanner.version ||
    !browser?.name ||
    !browser.version ||
    browser.sandbox === undefined ||
    !requestedOrigin ||
    !finalOrigin ||
    durationMs === undefined ||
    settleMs === undefined ||
    timeoutMs === undefined ||
    droppedRequests === undefined ||
    !egress ||
    egress.allowedConnections === undefined ||
    egress.blockedConnections === undefined ||
    egress.limitRefusals === undefined ||
    egress.failedConnections === undefined ||
    egress.blockedDestinationsTruncated === undefined ||
    !egress.blockedDestinations
  )
    return undefined;
  return {
    mode: "local-cli",
    scanner: { name: scanner.name, version: scanner.version },
    browser: {
      name: browser.name,
      version: browser.version,
      sandbox: browser.sandbox,
    },
    requestedOrigin,
    finalOrigin,
    durationMs,
    settleMs,
    timeoutMs,
    droppedRequests,
    egress: {
      allowedConnections: egress.allowedConnections,
      blockedConnections: egress.blockedConnections,
      limitRefusals: egress.limitRefusals,
      failedConnections: egress.failedConnections,
      blockedDestinationsTruncated: egress.blockedDestinationsTruncated,
      blockedDestinations: egress.blockedDestinations,
    },
  } satisfies ScanProvenance;
}

const TOP_LEVEL = [
  "schemaVersion",
  "targetUrl",
  "scannedAt",
  "status",
  "technologies",
  "cookies",
  "thirdPartyRequests",
  "cmp",
  "concerns",
  "limitations",
  "signatureSetVersion",
  "provenance",
] as const;

export function validateReport(input: unknown): ValidationResult {
  const issues = new Issues();
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    issues.add("", `a report must be a JSON object, found ${describe(input)}`);
    return { ok: false, issues: issues.list, truncated: false };
  }
  const top = input as Rec;

  // Version first: a file from another version should say so, not produce a
  // wall of field errors.
  if (!has(top, "schemaVersion")) {
    issues.add(
      "schemaVersion",
      "is missing. This file was not produced by a PrivacyLens version this page supports",
    );
    return { ok: false, issues: issues.list, truncated: false };
  }
  if (top.schemaVersion !== REPORT_SCHEMA_VERSION) {
    const version = top.schemaVersion;
    const newer =
      typeof version === "number" &&
      Number.isInteger(version) &&
      version > REPORT_SCHEMA_VERSION;
    issues.add(
      "schemaVersion",
      newer
        ? `is ${version}, newer than the version ${REPORT_SCHEMA_VERSION} this page understands. Update PrivacyLens to open it`
        : `is not a supported version (this page understands version ${REPORT_SCHEMA_VERSION})`,
    );
    return { ok: false, issues: issues.list, truncated: false };
  }

  const rec = record(issues, top, "", TOP_LEVEL);
  if (!rec)
    return { ok: false, issues: issues.list, truncated: issues.truncated };

  const targetUrl = origin(issues, rec.targetUrl, "targetUrl");
  const scannedAt = isoDate(issues, rec.scannedAt, "scannedAt");
  if (rec.status !== "completed") issues.add("status", 'must be "completed"');
  const technologies = list(
    issues,
    rec.technologies,
    "technologies",
    LIMITS.technologies,
    (item, at) => technology(issues, item, at),
  );
  const cookies = list(
    issues,
    rec.cookies,
    "cookies",
    LIMITS.cookies,
    (item, at) => cookie(issues, item, at),
  );
  const thirdPartyRequests = list(
    issues,
    rec.thirdPartyRequests,
    "thirdPartyRequests",
    LIMITS.requests,
    (item, at) => request(issues, item, at),
  );

  const cmpRec = record(issues, rec.cmp, "cmp", [
    "detected",
    "name",
    "evidence",
  ]);
  let cmp: ScanReport["cmp"] | undefined;
  if (cmpRec) {
    const detected = bool(issues, cmpRec.detected, "cmp.detected");
    const name = has(cmpRec, "name")
      ? text(issues, cmpRec.name, "cmp.name", 100, { min: 1 })
      : undefined;
    const evidence = has(cmpRec, "evidence")
      ? text(issues, cmpRec.evidence, "cmp.evidence", LIMITS.shortText, {
          min: 1,
        })
      : undefined;
    if (detected !== undefined)
      cmp = {
        detected,
        ...(name !== undefined ? { name } : {}),
        ...(evidence !== undefined ? { evidence } : {}),
      };
  }

  const concerns = list(
    issues,
    rec.concerns,
    "concerns",
    LIMITS.concerns,
    (item, at) => {
      const c = record(issues, item, at, ["title", "detail", "level"]);
      if (!c) return undefined;
      const title = text(issues, c.title, `${at}.title`, LIMITS.shortText, {
        min: 1,
      });
      const detail = text(issues, c.detail, `${at}.detail`, LIMITS.text, {
        min: 1,
      });
      const level = oneOf(issues, c.level, `${at}.level`, [
        "info",
        "attention",
      ] as const);
      return title !== undefined && detail !== undefined && level !== undefined
        ? { title, detail, level }
        : undefined;
    },
  );
  const limitations = list(
    issues,
    rec.limitations,
    "limitations",
    LIMITS.limitations,
    (item, at) => text(issues, item, at, LIMITS.text, { min: 1 }),
  );
  const signatureSetVersion = has(rec, "signatureSetVersion")
    ? text(issues, rec.signatureSetVersion, "signatureSetVersion", 32, {
        min: 1,
        pattern: TOKEN,
      })
    : undefined;
  const provenanceValue = has(rec, "provenance")
    ? provenance(issues, rec.provenance, "provenance")
    : undefined;

  if (
    issues.any ||
    !targetUrl ||
    !scannedAt ||
    !technologies ||
    !cookies ||
    !thirdPartyRequests ||
    !cmp ||
    !concerns ||
    !limitations
  )
    return { ok: false, issues: issues.list, truncated: issues.truncated };

  return {
    ok: true,
    report: {
      schemaVersion: REPORT_SCHEMA_VERSION,
      targetUrl,
      scannedAt,
      status: "completed",
      technologies,
      cookies,
      thirdPartyRequests,
      cmp,
      concerns,
      limitations,
      ...(signatureSetVersion !== undefined ? { signatureSetVersion } : {}),
      ...(provenanceValue ? { provenance: provenanceValue } : {}),
    },
  };
}
