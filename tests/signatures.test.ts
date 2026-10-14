import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assessRequest, detectTechnology } from "../src/scanner/detectors";
import { SIGNATURE_SET_VERSION, signatures } from "../src/scanner/signatures";

function contentHash(): string {
  const canonical = signatures.map((signature) => ({
    ...signature,
    path: signature.path?.source,
    pathFlags: signature.path?.flags,
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

describe("signature governance", () => {
  it("requires a version bump whenever signature content changes", () => {
    // If this fails you changed a signature. Bump SIGNATURE_SET_VERSION in
    // src/scanner/signatures.ts, then update both values here.
    expect({ version: SIGNATURE_SET_VERSION, hash: contentHash() }).toEqual({
      version: "2026-10-14.1",
      hash: "409a0bcb202b0fcce65847008c31ca116bb3780a1bab65bd50a21bde25d5aeaa",
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

  it("has positive and negative examples for every signature", () => {
    for (const signature of signatures) {
      expect(signature.examples.positive.length).toBeGreaterThan(0);
      expect(signature.examples.negative.length).toBeGreaterThan(0);
    }
  });

  describe.each(signatures.map((signature) => [signature.id, signature]))(
    "%s",
    (_id, signature) => {
      it("attributes every positive example to itself", () => {
        for (const address of signature.examples.positive) {
          expect(detectTechnology(new URL(address))?.name, address).toBe(
            signature.name,
          );
        }
      });

      it("does not attribute any negative example to itself", () => {
        for (const address of signature.examples.negative) {
          expect(detectTechnology(new URL(address))?.name, address).not.toBe(
            signature.name,
          );
        }
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
