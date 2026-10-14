import { describe, expect, it } from "vitest";
import {
  UnsafeTargetError,
  validateFixtureUrl,
  validatePublicUrl,
} from "../src/scanner/url-policy";

describe("target URL policy", () => {
  it.each([
    "file:///etc/passwd",
    "http://localhost/",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://example.com:8080/",
    "https://user:pass@example.com/",
  ])("rejects unsafe public target %s", async (input) => {
    await expect(validatePublicUrl(input)).rejects.toBeInstanceOf(
      UnsafeTargetError,
    );
  });

  it("keeps local fixtures confined to an exact origin", () => {
    const origin = "http://127.0.0.1:32123";
    expect(validateFixtureUrl(`${origin}/test`, origin).pathname).toBe("/test");
    expect(() =>
      validateFixtureUrl("http://127.0.0.1:32124/test", origin),
    ).toThrow(UnsafeTargetError);
    expect(() =>
      validateFixtureUrl("http://localhost:32123/test", origin),
    ).toThrow(UnsafeTargetError);
    expect(() =>
      validateFixtureUrl("http://example.com/test", "http://example.com"),
    ).toThrow(UnsafeTargetError);
  });
});
