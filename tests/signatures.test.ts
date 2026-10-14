import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assessRequest, detectTechnology } from "../src/scanner/detectors";
import { SIGNATURE_SET_VERSION, signatures } from "../src/scanner/signatures";

// JSON.stringify turns a RegExp into {}, so serialize every pattern explicitly;
// otherwise a changed rule would not change the hash.
function contentHash(): string {
  const canonical = JSON.stringify(signatures, (_key, value: unknown) =>
    value instanceof RegExp ? `/${value.source}/${value.flags}` : value,
  );
  return createHash("sha256").update(canonical).digest("hex");
}

describe("signature governance", () => {
  it("requires a version bump whenever signature content changes", () => {
    // If this fails you changed a signature. Bump SIGNATURE_SET_VERSION in
    // src/scanner/signatures.ts, then update both values here.
    expect({ version: SIGNATURE_SET_VERSION, hash: contentHash() }).toEqual({
      version: "2026-10-14.3",
      hash: "fca5c78ebd7d18e2d6042b790c82c2d52561a643bd6691257ca15ad2dad72b35",
    });
  });

  it("has unique ids and lowercase domains", () => {
    const ids = signatures.map((signature) => signature.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const signature of signatures) {
      expect(signature.id).toMatch(/^[a-z0-9-]+$/);
      for (const domain of signature.domains)
        expect(domain).toBe(domain.toLowerCase());
      expect(signature.criteria.length).toBeGreaterThan(20);
    }
  });

  it("requires a path rule unless the whole domain is dedicated to tooling", () => {
    const dedicated = new Set([
      "google-tag-manager",
      "google-ads",
      "microsoft-clarity",
    ]);
    for (const signature of signatures) {
      if (!signature.path) expect(dedicated.has(signature.id)).toBe(true);
    }
  });

  it("records sources with fetch dates, and flags every unsourced claim", () => {
    for (const signature of signatures) {
      for (const source of signature.sources) {
        expect(source.url).toMatch(/^https:\/\//);
        expect(source.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(source.supports.length).toBeGreaterThan(0);
      }
      // A signature with no source must say plainly what is unverified.
      if (signature.sources.length === 0)
        expect(signature.unverified.length).toBeGreaterThan(0);
    }
  });

  it("has attributed and negative examples for every signature", () => {
    for (const signature of signatures) {
      const { observed, inferred, negative } = signature.examples;
      expect(observed.length + inferred.length).toBeGreaterThan(0);
      expect(negative.length).toBeGreaterThan(0);
    }
  });

  it("never claims observed without a collection rule, and says when it is unsourced", () => {
    for (const signature of signatures) {
      if (!signature.collection) {
        expect(signature.examples.observed).toEqual([]);
        expect(signature.collectionSourced).toBe(false);
      }
      if (signature.collectionSourced) {
        expect(signature.sources.length).toBeGreaterThan(0);
      }
    }
  });

  describe.each(signatures.map((signature) => [signature.id, signature]))(
    "%s",
    (_id, signature) => {
      it("reproduces every documented example", () => {
        for (const address of signature.examples.observed) {
          const result = assessRequest(new URL(address), "fetch");
          expect(result.classification, address).toBe("observed");
          expect(result.signature?.id, address).toBe(signature.id);
          expect(result.reason, address).toContain(signature.id);
          // The same URL loaded as a script is never evidence of collection.
          expect(
            assessRequest(new URL(address), "script").classification,
            address,
          ).toBe("inferred");
        }
        for (const address of signature.examples.inferred) {
          const result = assessRequest(new URL(address), "fetch");
          expect(result.classification, address).toBe("inferred");
          expect(result.signature?.id, address).toBe(signature.id);
        }
      });

      it("does not attribute any negative example to itself", () => {
        for (const address of signature.examples.negative) {
          expect(detectTechnology(new URL(address))?.name, address).not.toBe(
            signature.name,
          );
          expect(
            assessRequest(new URL(address), "fetch").classification,
            address,
          ).toBe("unknown");
        }
      });

      it("flags an unsourced collection pattern in the reason", () => {
        const [address] = signature.examples.observed;
        if (!address) return;
        const { reason } = assessRequest(new URL(address), "fetch");
        expect(reason.includes("not yet confirmed")).toBe(
          !signature.collectionSourced,
        );
      });
    },
  );
});

describe("request assessment", () => {
  it("is observed only for a recognized collection endpoint, with evidence", () => {
    const result = assessRequest(
      new URL("https://www.google-analytics.com/g/collect?v=2&cid=secret"),
      "fetch",
    );
    expect(result).toMatchObject({
      classification: "observed",
      technology: { name: "Google Analytics" },
      signature: { id: "google-analytics", version: SIGNATURE_SET_VERSION },
    });
    expect(result.reason).toContain("Initiation only");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("is inferred, not observed, for a vendor script", () => {
    const result = assessRequest(
      new URL("https://www.googletagmanager.com/gtag/js?id=G-X"),
      "script",
    );
    expect(result.classification).toBe("inferred");
    expect(result.reason).toContain("does not show that data was sent");
  });

  it("does not call an endpoint-shaped path on a vendor without a collection rule observed", () => {
    for (const address of [
      "https://www.googletagmanager.com/events",
      "https://www.googletagmanager.com/collect",
      "https://googleads.g.doubleclick.net/collect",
    ]) {
      expect(
        assessRequest(new URL(address), "fetch").classification,
        address,
      ).toBe("inferred");
    }
  });

  it("is unknown for a vendor host at an unrecognized path", () => {
    const result = assessRequest(
      new URL("https://www.facebook.com/trending"),
      "fetch",
    );
    expect(result.classification).toBe("unknown");
    expect(result.technology).toBeUndefined();
    expect(result.reason).toContain("Meta Pixel");
  });

  it("is unknown for an unrecognized destination", () => {
    const result = assessRequest(
      new URL("https://cdn.example.net/app.js"),
      "script",
    );
    expect(result.classification).toBe("unknown");
    expect(result.signature).toBeUndefined();
  });
});
