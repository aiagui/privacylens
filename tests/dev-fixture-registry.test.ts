import { afterEach, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { POST } from "../src/app/api/dev/scan-fixture/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([
  "__proto__",
  "constructor",
  "toString",
  "hasOwnProperty",
  "unknown-fixture",
])(
  "rejects unregistered fixture ID %s without launching Chromium",
  async (fixtureId) => {
    vi.stubEnv("NODE_ENV", "test");
    const launch = vi.spyOn(chromium, "launch");
    const response = await POST(
      new Request("http://localhost/api/dev/scan-fixture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixtureId }),
      }),
    );
    const result = await response.json();
    expect(response.status).toBe(400);
    expect(result.error?.code).toBe("UNKNOWN_FIXTURE");
    expect(launch).not.toHaveBeenCalled();
  },
  20_000,
);
