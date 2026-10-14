import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../src/proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dev route proxy guard", () => {
  it("blocks /api/dev/* when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = proxy(
      new NextRequest("http://localhost/api/dev/scan-fixture"),
    );
    expect(response.status).toBe(404);
  });

  it("passes /api/dev/* through outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = proxy(
      new NextRequest("http://localhost/api/dev/scan-fixture"),
    );
    expect(response.status).not.toBe(404);
  });

  it("does not affect unrelated paths even in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = proxy(new NextRequest("http://localhost/api/scan"));
    expect(response.status).not.toBe(404);
  });
});
