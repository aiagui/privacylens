import { describe, expect, it } from "vitest";
import { sanitizeCookieName } from "../src/scanner/collector-common";

describe("cookie name redaction", () => {
  it.each([
    "sess_9f8a7b6c5d4e3f2a1b0c",
    "visitor-1234567890123",
    "eyJhbGciOiJIUzI1NiJ9",
    "auth_token",
    "api-key",
    "someone@example.com",
    "x".repeat(129),
    "bad\u001bname",
    "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6",
  ])("redacts identifier-like or secret-looking name %j", (name) => {
    expect(sanitizeCookieName(name)).toBe("[REDACTED]");
  });

  it.each([
    "_ga",
    "_fbp",
    "session_id",
    "cookie_consent",
    "OptanonConsent",
    "NID",
    "csrf",
  ])("keeps ordinary readable name %s", (name) => {
    expect(sanitizeCookieName(name)).toBe(name);
  });

  it("gives a nameless cookie a placeholder, because Chromium reports one as an empty name", () => {
    expect(sanitizeCookieName("")).toBe("[unnamed]");
  });

  it.each([
    "a\u200bb",
    "\u202eevil",
    "x\u0085y",
    "x\u200fy",
    "x\u2066y",
    "x\ufeffy",
    "x\u007fy",
  ])(
    "redacts a name with a character the report format refuses (%j)",
    (name) => {
      expect(sanitizeCookieName(name)).toBe("[REDACTED]");
    },
  );

  it("keeps a name written with a zero-width joiner", () => {
    expect(sanitizeCookieName("می\u200cخواهم")).toBe("می\u200cخواهم");
  });
});
