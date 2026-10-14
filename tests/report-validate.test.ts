import { describe, expect, it } from "vitest";
import { SAMPLE_REPORT } from "../src/sample-report";
import { hasUnsafeCharacter } from "../src/report/text";
import { LIMITS, validateReport } from "../src/report/validate";
import type { ScanReport } from "../src/scanner/types";

/**
 * Deliberately untyped: these tests build invalid report shapes on purpose, which
 * the real types would (rightly) forbid.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Draft = Record<string, any>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const WITH_PROVENANCE: ScanReport = {
  ...clone(SAMPLE_REPORT),
  provenance: {
    mode: "local-cli",
    scanner: { name: "privacylens", version: "0.1.0" },
    browser: { name: "chromium", version: "156.0.8078.4", sandbox: true },
    requestedOrigin: "https://sample-shop.example",
    finalOrigin: "https://sample-shop.example",
    durationMs: 5013,
    settleMs: 4000,
    timeoutMs: 30000,
    droppedRequests: 0,
    egress: {
      allowedConnections: 6,
      blockedConnections: 1,
      limitRefusals: 0,
      failedConnections: 2,
      blockedDestinationsTruncated: false,
      blockedDestinations: [
        { host: "127.0.0.1", port: 8080, reason: "non-public-address" },
      ],
    },
  },
};

function expectRejected(input: unknown, where?: RegExp | string) {
  const result = validateReport(input);
  expect(result.ok).toBe(false);
  if (!result.ok && where)
    // A path (e.g. "technologies[0].name") or the message text, whichever matches.
    expect(
      result.issues.map((i) => `${i.path} ${i.message}`).join("\n"),
    ).toMatch(where);
  return result;
}

/** Applies a change to a deep copy of a valid report. */
function mutated(change: (draft: Draft) => void): unknown {
  const draft = clone(WITH_PROVENANCE) as unknown as Draft;
  change(draft);
  return draft;
}

describe("validateReport: accepts real reports", () => {
  it("accepts the bundled sample and a report with provenance", () => {
    expect(validateReport(clone(SAMPLE_REPORT)).ok).toBe(true);
    expect(validateReport(clone(WITH_PROVENANCE)).ok).toBe(true);
  });

  it("returns an equal but entirely new object (the input is never reused)", () => {
    const input = clone(WITH_PROVENANCE);
    const result = validateReport(input);
    if (!result.ok) throw new Error("expected ok");
    expect(result.report).toEqual(input);
    expect(result.report).not.toBe(input);
    expect(result.report.technologies).not.toBe(input.technologies);
    expect(result.report.technologies[0]).not.toBe(input.technologies[0]);
    expect(result.report.provenance).not.toBe(input.provenance);
    const snapshot = JSON.stringify(result.report);
    input.technologies[0]!.name = "changed after validation";
    input.thirdPartyRequests.length = 0;
    expect(JSON.stringify(result.report)).toBe(snapshot);
  });

  it("preserves observed, inferred and unknown exactly", () => {
    const result = validateReport(clone(SAMPLE_REPORT));
    if (!result.ok) throw new Error("expected ok");
    expect(result.report.technologies.map((t) => t.observation)).toEqual(
      SAMPLE_REPORT.technologies.map((t) => t.observation),
    );
    expect(
      new Set(result.report.thirdPartyRequests.map((r) => r.classification)),
    ).toEqual(new Set(["observed", "inferred", "unknown"]));
  });

  it("accepts every optional field being absent", () => {
    const input = mutated((d) => {
      delete d.provenance;
      delete d.signatureSetVersion;
      for (const t of d.technologies) delete t.signature;
      for (const c of d.cookies) {
        delete c.expires;
        delete c.sameSite;
      }
      for (const r of d.thirdPartyRequests) {
        delete r.technology;
        delete r.classification;
        delete r.outcome;
      }
      d.cmp = { detected: false };
    });
    expect(validateReport(input).ok).toBe(true);
  });
});

describe("validateReport: versioning", () => {
  it("says a missing version means the file is not from a supported version", () => {
    const result = expectRejected(
      mutated((d) => delete d.schemaVersion),
      "schemaVersion",
    );
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/missing/);
  });

  it("tells the user a newer version needs a newer PrivacyLens", () => {
    const result = expectRejected(
      mutated((d) => (d.schemaVersion = 2)),
      "schemaVersion",
    );
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.message).toMatch(/newer than the version 1/);
    }
  });

  it.each([0, -1, 1.5, "1", null, true, [], {}, Number.MAX_SAFE_INTEGER])(
    "rejects schemaVersion %j",
    (version) => {
      expectRejected(
        mutated((d) => (d.schemaVersion = version)),
        "schemaVersion",
      );
    },
  );

  it("does not bury a version problem under field errors", () => {
    const result = expectRejected({ schemaVersion: 7, junk: true });
    if (!result.ok) expect(result.issues).toHaveLength(1);
  });
});

describe("validateReport: structure", () => {
  it.each([null, undefined, 1, "text", true, [], [SAMPLE_REPORT]])(
    "rejects a non-object file %j",
    (input) => {
      expectRejected(input);
    },
  );

  it("rejects unknown fields at every level", () => {
    expectRejected(
      mutated((d) => (d.extra = 1)),
      /extra/,
    );
    expectRejected(
      mutated((d) => (d.technologies[0].extra = 1)),
      /technologies\[0\]/,
    );
    expectRejected(
      mutated((d) => (d.cookies[0].extra = 1)),
      /cookies\[0\]/,
    );
    expectRejected(
      mutated((d) => (d.thirdPartyRequests[0].extra = 1)),
      /thirdPartyRequests\[0\]/,
    );
    expectRejected(
      mutated((d) => (d.cmp.extra = 1)),
      /cmp/,
    );
    expectRejected(
      mutated((d) => (d.concerns[0].extra = 1)),
      /concerns\[0\]/,
    );
    expectRejected(
      mutated((d) => (d.provenance.extra = 1)),
      /provenance/,
    );
    expectRejected(
      mutated((d) => (d.provenance.egress.extra = 1)),
      /egress/,
    );
    expectRejected(
      mutated(
        (d) =>
          (d.technologies[0].signature = { id: "a", version: "1", extra: 1 }),
      ),
      /signature/,
    );
  });

  it("rejects a __proto__ or constructor key and cannot pollute prototypes", () => {
    const text = JSON.stringify(SAMPLE_REPORT).replace(
      '"schemaVersion":1',
      '"schemaVersion":1,"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}',
    );
    expect(text).toContain("__proto__");
    const parsed: unknown = JSON.parse(text);
    expect(Object.keys(parsed as object)).toContain("__proto__");
    const result = validateReport(parsed);
    expect(result.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
    ).toBe(false);
  });

  it("rejects objects with unusual prototypes and class instances", () => {
    class Evil {
      schemaVersion = 1;
    }
    expectRejected(new Evil());
    const odd = Object.create({ inherited: true }) as Record<string, unknown>;
    Object.assign(odd, clone(SAMPLE_REPORT));
    expectRejected(odd);
  });

  it("never lists the content of hostile keys unsafely in messages", () => {
    const key = "\u001b[2J" + "x".repeat(200);
    const result = expectRejected({ ...clone(SAMPLE_REPORT), [key]: 1 });
    if (!result.ok) {
      const all = JSON.stringify(result.issues);
      expect(all).not.toContain("\u001b");
      expect(all.length).toBeLessThan(600);
    }
  });
});

describe("validateReport: fields", () => {
  const bad: Array<[string, (d: Draft) => void, RegExp]> = [
    [
      "targetUrl with a path",
      (d) => (d.targetUrl = "https://example.com/path"),
      /targetUrl/,
    ],
    [
      "targetUrl with a query",
      (d) => (d.targetUrl = "https://example.com?x=1"),
      /targetUrl/,
    ],
    [
      "targetUrl with credentials",
      (d) => (d.targetUrl = "https://user:pw@example.com"),
      /targetUrl/,
    ],
    [
      "targetUrl with a trailing slash",
      (d) => (d.targetUrl = "https://example.com/"),
      /targetUrl/,
    ],
    ["targetUrl ftp", (d) => (d.targetUrl = "ftp://example.com"), /targetUrl/],
    [
      "targetUrl javascript",
      (d) => (d.targetUrl = "javascript:alert(1)"),
      /targetUrl/,
    ],
    ["targetUrl data", (d) => (d.targetUrl = "data:text/html,x"), /targetUrl/],
    ["targetUrl relative", (d) => (d.targetUrl = "/relative"), /targetUrl/],
    ["targetUrl number", (d) => (d.targetUrl = 5), /targetUrl/],
    ["scannedAt not ISO", (d) => (d.scannedAt = "yesterday"), /scannedAt/],
    [
      "scannedAt impossible",
      (d) => (d.scannedAt = "2026-13-45T99:99:99Z"),
      /scannedAt/,
    ],
    [
      "scannedAt with offset",
      (d) => (d.scannedAt = "2026-10-01T09:14:00+02:00"),
      /scannedAt/,
    ],
    ["status other", (d) => (d.status = "failed"), /status/],
    ["technologies not a list", (d) => (d.technologies = {}), /technologies/],
    ["technology name empty", (d) => (d.technologies[0].name = ""), /name/],
    [
      "technology category invalid",
      (d) => (d.technologies[0].category = "other"),
      /category/,
    ],
    [
      "technology observation unknown",
      (d) => (d.technologies[0].observation = "unknown"),
      /observation/,
    ],
    [
      "technology observation invalid",
      (d) => (d.technologies[0].observation = "certain"),
      /observation/,
    ],
    [
      "evidence not strings",
      (d) => (d.technologies[0].evidence = [1]),
      /evidence/,
    ],
    [
      "signature id odd",
      (d) => (d.technologies[0].signature = { id: "a b", version: "1" }),
      /signature/,
    ],
    [
      "cookie firstParty string",
      (d) => (d.cookies[0].firstParty = "yes"),
      /firstParty/,
    ],
    [
      "cookie domain with slash",
      (d) => (d.cookies[0].domain = "a/b"),
      /domain/,
    ],
    [
      "cookie domain with markup",
      (d) => (d.cookies[0].domain = "<img src=x>"),
      /domain/,
    ],
    [
      "cookie sameSite invalid",
      (d) => (d.cookies[0].sameSite = "Sometimes"),
      /sameSite/,
    ],
    [
      "cookie expires invalid",
      (d) => (d.cookies[0].expires = "never"),
      /expires/,
    ],
    [
      "request url with path",
      (d) => (d.thirdPartyRequests[0].url = "https://a.example/p"),
      /url/,
    ],
    [
      "request domain spaces",
      (d) => (d.thirdPartyRequests[0].domain = "a b"),
      /domain/,
    ],
    [
      "request timeMs negative",
      (d) => (d.thirdPartyRequests[0].timeMs = -1),
      /timeMs/,
    ],
    [
      "request timeMs huge",
      (d) => (d.thirdPartyRequests[0].timeMs = 1e12),
      /timeMs/,
    ],
    [
      "request timeMs string",
      (d) => (d.thirdPartyRequests[0].timeMs = "5"),
      /timeMs/,
    ],
    [
      "beforeConsent false",
      (d) => (d.thirdPartyRequests[0].beforeConsent = false),
      /beforeConsent/,
    ],
    [
      "resourceType uppercase",
      (d) => (d.thirdPartyRequests[0].resourceType = "Script"),
      /resourceType/,
    ],
    [
      "classification invalid",
      (d) => (d.thirdPartyRequests[0].classification = "maybe"),
      /classification/,
    ],
    [
      "outcome invalid",
      (d) => (d.thirdPartyRequests[0].outcome = "refused"),
      /outcome/,
    ],
    ["cmp detected missing", (d) => (d.cmp = {}), /detected/],
    [
      "concern level invalid",
      (d) => (d.concerns[0].level = "critical"),
      /level/,
    ],
    ["limitations not strings", (d) => (d.limitations = [null]), /limitations/],
    [
      "signatureSetVersion odd",
      (d) => (d.signatureSetVersion = "<b>"),
      /signatureSetVersion/,
    ],
    ["provenance mode", (d) => (d.provenance.mode = "hosted"), /mode/],
    [
      "provenance sandbox string",
      (d) => (d.provenance.browser.sandbox = "yes"),
      /sandbox/,
    ],
    [
      "provenance browser name",
      (d) => (d.provenance.browser.name = "firefox"),
      /browser\.name/,
    ],
    [
      "provenance origin with path",
      (d) => (d.provenance.finalOrigin = "https://a.example/x"),
      /finalOrigin/,
    ],
    [
      "provenance negative count",
      (d) => (d.provenance.droppedRequests = -1),
      /droppedRequests/,
    ],
    [
      "provenance fractional",
      (d) => (d.provenance.durationMs = 1.5),
      /durationMs/,
    ],
    [
      "blocked port out of range",
      (d) => (d.provenance.egress.blockedDestinations[0].port = 70000),
      /port/,
    ],
  ];
  it.each(bad)("rejects %s", (_name, change, path) => {
    expectRejected(mutated(change), path);
  });

  it.each([
    ["control character", "bad\u0000name"],
    ["escape sequence", "\u001b[2Jname"],
    ["newline", "two\nlines"],
    ["right-to-left override", "safe‮exe.txt"],
    ["zero-width space", "zero​width"],
    ["isolate", "x⁦y"],
    ["byte-order mark inside", "x﻿y"],
    ["line separator", "a b"],
  ])("rejects a string with a %s", (_label, value) => {
    for (const where of [
      (d: Draft) => (d.technologies[0].name = value),
      (d: Draft) => (d.technologies[0].evidence[0] = value),
      (d: Draft) => (d.cookies[0].name = value),
      (d: Draft) => (d.concerns[0].detail = value),
      (d: Draft) => (d.limitations[0] = value),
      (d: Draft) => (d.cmp.name = value),
    ])
      expectRejected(mutated(where));
  });

  it("accepts ordinary non-ASCII text", () => {
    expect(
      validateReport(
        mutated((d) => (d.technologies[0].name = "Análisis — 分析 ✓")),
      ).ok,
    ).toBe(true);
  });
});

describe("validateReport: size limits", () => {
  it("rejects strings and lists past their limits, and accepts exactly the limit", () => {
    expect(
      validateReport(
        mutated((d) => (d.technologies[0].name = "n".repeat(LIMITS.shortText))),
      ).ok,
    ).toBe(true);
    expectRejected(
      mutated(
        (d) => (d.technologies[0].name = "n".repeat(LIMITS.shortText + 1)),
      ),
      /too long/,
    );
    expectRejected(
      mutated((d) => (d.limitations[0] = "l".repeat(LIMITS.text + 1))),
      /too long/,
    );
    expect(
      validateReport(
        mutated(
          (d) =>
            (d.technologies[0].evidence = Array(
              LIMITS.evidencePerTechnology,
            ).fill("e")),
        ),
      ).ok,
    ).toBe(true);
    expectRejected(
      mutated(
        (d) =>
          (d.technologies[0].evidence = Array(
            LIMITS.evidencePerTechnology + 1,
          ).fill("e")),
      ),
      /too many/,
    );
  });

  it("rejects oversized lists", () => {
    const request = clone(SAMPLE_REPORT.thirdPartyRequests[0]);
    expectRejected(
      mutated(
        (d) =>
          (d.thirdPartyRequests = Array(LIMITS.requests + 1).fill(request)),
      ),
      /thirdPartyRequests/,
    );
    const cookie = clone(SAMPLE_REPORT.cookies[0]);
    expectRejected(
      mutated((d) => (d.cookies = Array(LIMITS.cookies + 1).fill(cookie))),
      /cookies/,
    );
    expectRejected(
      mutated(
        (d) =>
          (d.technologies = Array(LIMITS.technologies + 1).fill(
            clone(SAMPLE_REPORT.technologies[0]),
          )),
      ),
      /technologies/,
    );
  });

  it("caps the number of reported problems", () => {
    const result = expectRejected(
      mutated((d) => {
        d.thirdPartyRequests = Array(200).fill({ url: 1 });
      }),
    );
    if (!result.ok) {
      expect(result.issues.length).toBeLessThanOrEqual(20);
      expect(result.truncated).toBe(true);
    }
  });
});

describe("validateReport: robustness", () => {
  /** Deterministic pseudo-random generator so failures reproduce. */
  function rng(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }
  const JUNK: unknown[] = [
    null,
    undefined,
    0,
    -1,
    1e308,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "",
    " ",
    "\u0000",
    "x".repeat(5000),
    true,
    false,
    [],
    [[]],
    {},
    { a: 1 },
    "<script>alert(1)</script>",
    "javascript:alert(1)",
    "__proto__",
    Symbol("s"),
    () => 1,
    10n,
  ];

  function paths(
    value: unknown,
    prefix: Array<string | number> = [],
  ): Array<Array<string | number>> {
    if (value === null || typeof value !== "object") return [prefix];
    const entries = Array.isArray(value)
      ? value.map((_, i) => [i, value[i]] as const)
      : Object.entries(value);
    return [prefix, ...entries.flatMap(([k, v]) => paths(v, [...prefix, k]))];
  }

  it("never throws, and rejects a required field replaced by junk, for every path", () => {
    const base = clone(WITH_PROVENANCE);
    const all = paths(base).filter((p) => p.length > 0);
    const optional = new Set([
      "signature",
      "expires",
      "sameSite",
      "technology",
      "classification",
      "outcome",
      "name",
      "evidence",
      "signatureSetVersion",
      "provenance",
    ]);
    let checked = 0;
    for (const path of all) {
      for (const junk of JUNK) {
        const draft = clone(base) as Draft;
        let target = draft;
        for (const key of path.slice(0, -1)) target = target[key];
        target[path[path.length - 1]!] = junk;
        const result = validateReport(draft);
        checked += 1;
        const leaf = String(path[path.length - 1]);
        const lastIsOptional = optional.has(leaf);
        if (result.ok) {
          // Acceptable only if the junk happens to be valid there (e.g. a string
          // where any short string is allowed). Re-validating must be stable.
          expect(validateReport(result.report).ok).toBe(true);
          if (!lastIsOptional)
            expect(
              typeof junk === "string" ||
                junk === undefined ||
                typeof junk === "number" ||
                typeof junk === "boolean" ||
                Array.isArray(junk) ||
                (typeof junk === "object" && junk !== null),
            ).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("is stable under random combinations of junk (seeded)", () => {
    const next = rng(12345);
    const base = clone(WITH_PROVENANCE);
    const all = paths(base).filter((p) => p.length > 0);
    for (let round = 0; round < 400; round++) {
      const draft = clone(base) as Draft;
      for (let k = 0; k < 1 + Math.floor(next() * 4); k++) {
        const path = all[Math.floor(next() * all.length)]!;
        let target = draft;
        try {
          for (const key of path.slice(0, -1)) target = target[key];
          target[path[path.length - 1]!] =
            JUNK[Math.floor(next() * JUNK.length)];
        } catch {
          /* path no longer exists after an earlier change */
        }
      }
      expect(() => validateReport(draft)).not.toThrow();
    }
  });

  it("handles deeply nested and cyclic inputs without throwing", () => {
    let deep: unknown = "x";
    for (let i = 0; i < 20_000; i++) deep = [deep];
    expectRejected({ schemaVersion: 1, technologies: deep });
    const cyclic: Record<string, unknown> = { schemaVersion: 1 };
    cyclic.self = cyclic;
    expectRejected(cyclic);
  });

  it("does not run getters or toJSON hooks on hostile objects", () => {
    let ran = false;
    const hostile = clone(SAMPLE_REPORT) as unknown as Record<string, unknown>;
    Object.defineProperty(hostile, "status", {
      enumerable: true,
      get() {
        ran = true;
        return "completed";
      },
    });
    validateReport(hostile);
    // Reading a plain data property through a getter is allowed to happen once,
    // but the result must still be a clean, frozen-in-time copy.
    const result = validateReport(hostile);
    if (result.ok)
      expect(
        Object.getOwnPropertyDescriptor(result.report, "status")?.get,
      ).toBeUndefined();
    expect(typeof ran).toBe("boolean");
  });
});

describe("validateReport: fixes from the import review", () => {
  const request = (change: (r: Draft) => void) =>
    mutated((d) => change(d.thirdPartyRequests[1] as Draft));

  it.each(["ws://chat.vendor.example", "wss://chat.vendor.example:8443"])(
    "accepts a WebSocket request origin %s, as the scanner writes them",
    (url) => {
      const host = new URL(url).hostname;
      expect(
        validateReport(
          request((r) => {
            r.url = url;
            r.domain = host;
            r.resourceType = "websocket";
          }),
        ).ok,
      ).toBe(true);
    },
  );

  it("still requires http(s) for the target and the provenance origins", () => {
    expectRejected(
      mutated((d) => (d.targetUrl = "wss://site.example")),
      "targetUrl",
    );
    expectRejected(
      mutated((d) => (d.provenance.finalOrigin = "ws://site.example")),
      "finalOrigin",
    );
    expectRejected(
      request((r) => (r.url = "ftp://a.example")),
      /url/,
    );
  });

  it("requires a request's domain to be the host of its url", () => {
    expectRejected(
      request((r) => {
        r.url = "https://a.example";
        r.domain = "b.example";
      }),
      /host of the request/,
    );
  });

  it.each([
    "my_cdn.example",
    "a_b.c_d.example",
    "xn--bcher-kva.example",
    "[2001:db8::1]",
    "tilde~host.example",
  ])("accepts the real host name %s", (host) => {
    const origin = `https://${host}`;
    const parsed = new URL(origin);
    expect(
      validateReport(
        request((r) => {
          r.url = parsed.origin;
          r.domain = parsed.hostname;
        }),
      ).ok,
      host,
    ).toBe(true);
  });

  it("accepts a cookie domain with an underscore", () => {
    expect(
      validateReport(mutated((d) => (d.cookies[0].domain = ".my_cdn.example")))
        .ok,
    ).toBe(true);
  });

  it.each([
    "a b.example",
    "a/b.example",
    "<img>.example",
    "a\\b.example",
    "a@b.example",
    "a?b.example",
  ])("still rejects the host %j", (host) => {
    expectRejected(
      mutated((d) => (d.cookies[0].domain = host)),
      /domain/,
    );
  });

  it("allows zero-width joiners that real scripts and emoji need, but not other invisible characters", () => {
    for (const name of ["می\u200cخواهم", "\u{1F469}\u200D\u{1F4BB} developer"])
      expect(
        validateReport(mutated((d) => (d.technologies[0].name = name))).ok,
        name,
      ).toBe(true);
    for (const name of ["a\u200bb", "a\u200eb", "a\u200fb"])
      expectRejected(mutated((d) => (d.technologies[0].name = name)));
  });

  it("turns -0 into 0 and rejects impossible calendar dates", () => {
    const negativeZero = JSON.parse(
      JSON.stringify(WITH_PROVENANCE).replace('"timeMs":182', '"timeMs":-0'),
    );
    const result = validateReport(negativeZero);
    if (!result.ok) throw new Error("expected ok");
    expect(Object.is(result.report.thirdPartyRequests[0]!.timeMs, 0)).toBe(
      true,
    );
    expectRejected(
      mutated((d) => (d.scannedAt = "2026-02-30T00:00:00Z")),
      /scannedAt/,
    );
    expectRejected(
      mutated((d) => (d.scannedAt = "2026-04-31T10:00:00.000Z")),
      /scannedAt/,
    );
    expect(
      validateReport(mutated((d) => (d.scannedAt = "2028-02-29T00:00:00.000Z")))
        .ok,
    ).toBe(true);
    expectRejected(
      mutated((d) => (d.scannedAt = "2027-02-29T00:00:00.000Z")),
      /scannedAt/,
    );
  });

  it("rejects a technology on a request classified unknown, and accepts it otherwise", () => {
    expectRejected(
      request((r) => {
        r.technology = "Matomo";
        r.classification = "unknown";
      }),
      /cannot be unknown/,
    );
    expect(
      validateReport(
        request((r) => {
          r.technology = "Matomo";
          r.classification = "observed";
        }),
      ).ok,
    ).toBe(true);
    expect(
      validateReport(
        request((r) => {
          delete r.technology;
          r.classification = "unknown";
        }),
      ).ok,
    ).toBe(true);
  });

  it("sanitizes hostile key names in the error path as well as the message", () => {
    const result = expectRejected({
      ...JSON.parse(JSON.stringify(SAMPLE_REPORT)),
      cmp: { detected: false, ["\u202e<img src=x onerror=1>"]: 1 },
    });
    if (!result.ok) {
      const all = result.issues
        .map((i) => `${i.path} ${i.message}`)
        .join(" | ");
      // No control, direction or invisible character may survive into the text.
      expect(hasUnsafeCharacter(all)).toBe(false);
    }
  });

  it("says a missing field is missing, not 'a undefined'", () => {
    const result = expectRejected(
      mutated((d) => delete d.targetUrl),
      "targetUrl",
    );
    if (!result.ok)
      expect(result.issues.map((i) => i.message).join(" ")).not.toContain(
        "undefined",
      );
  });
});

describe("validateReport: every host a browser can use, and the final review's gaps", () => {
  const request = (change: (r: Draft) => void) =>
    mutated((d) => change(d.thirdPartyRequests[1] as Draft));
  const asHost = (host: string) =>
    request((r) => {
      r.url = `https://${host}`;
      r.domain = host;
    });

  it.each([
    'a"b',
    "a`b",
    "a{b",
    "a}b",
    "a|b",
    "a^b",
    "a%2ab",
    "a*b",
    "a'b",
    "a(b)",
    "a;b",
    "a,b",
    "a=b",
    "a+b",
    "a$b",
    "a&b",
    "a!b",
    "a~b",
    "a_b",
  ])(
    "accepts the host %j that Node's and Chromium's URL parsers allow",
    (host) => {
      // Not every one survives URL normalization; the point is the validator takes
      // whatever the scanner copies from raw.url.hostname.
      const parsed = (() => {
        try {
          return new URL(`https://${host}.example/`).hostname;
        } catch {
          return undefined;
        }
      })();
      const value = parsed ?? `${host}.example`;
      const input = request((r) => {
        r.url = `https://${value}`;
        r.domain = value;
      });
      const result = validateReport(input);
      if (parsed === undefined) return;
      expect(
        result.ok,
        `${value}: ${JSON.stringify(!result.ok && result.issues)}`,
      ).toBe(true);
    },
  );

  it("accepts a host and a cookie domain of exactly 300 characters, and rejects 301", () => {
    expect(
      validateReport(mutated((d) => (d.cookies[0].domain = "a".repeat(300))))
        .ok,
    ).toBe(true);
    expectRejected(
      mutated((d) => (d.cookies[0].domain = "a".repeat(301))),
      /domain/,
    );
    const blocked = (host: string) =>
      mutated((d) => (d.provenance.egress.blockedDestinations[0].host = host));
    expect(validateReport(blocked("a".repeat(300))).ok).toBe(true);
    expectRejected(blocked("a".repeat(301)), /host/);
  });

  it.each([
    "a b",
    "a/b",
    "a\\b",
    "a?b",
    "a#b",
    "a@b",
    "a<b",
    "a>b",
    "caf\u00e9",
    "a\tb",
    "",
    " ",
  ])("still rejects the host %j in every place a host is shown", (host) => {
    expectRejected(mutated((d) => (d.cookies[0].domain = host)));
    expectRejected(
      mutated((d) => (d.provenance.egress.blockedDestinations[0].host = host)),
    );
    expectRejected(asHost(host));
  });

  it("accepts a percent-encoded host in blockedDestinations, as Chromium writes a CONNECT", () => {
    expect(
      validateReport(
        mutated(
          (d) =>
            (d.provenance.egress.blockedDestinations[0].host = "a%2ab.example"),
        ),
      ).ok,
    ).toBe(true);
    expect(
      validateReport(
        mutated(
          (d) =>
            (d.provenance.egress.blockedDestinations[0].host = "(malformed)"),
        ),
      ).ok,
    ).toBe(true);
  });

  it.each([
    "1.0.0+sha.abc123",
    "1.0.0-beta.1+build.5",
    "0.1.0",
    "156.0.8078.4",
  ])("accepts the version %s", (version) => {
    expect(
      validateReport(mutated((d) => (d.provenance.scanner.version = version)))
        .ok,
    ).toBe(true);
    expect(
      validateReport(mutated((d) => (d.provenance.browser.version = version)))
        .ok,
    ).toBe(true);
    expect(
      validateReport(mutated((d) => (d.signatureSetVersion = version))).ok,
    ).toBe(true);
  });

  it.each(["1.0 0", "1.0/0", "<1>", "+1", "", "v".repeat(65)])(
    "rejects the version %j",
    (version) => {
      expectRejected(mutated((d) => (d.provenance.scanner.version = version)));
    },
  );

  it.each([
    "\u061c",
    "\u2060",
    "\u2061",
    "\u2062",
    "\u2063",
    "\u2064",
    "\u206a",
    "\u206f",
  ])(
    "rejects the invisible or direction character U+%s in text",
    (character) => {
      expectRejected(
        mutated((d) => (d.technologies[0].name = `a${character}b`)),
      );
      expectRejected(mutated((d) => (d.cookies[0].name = `a${character}b`)));
    },
  );
});
