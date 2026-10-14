import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../src/app/api/dev/scan-fixture/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/dev/scan-fixture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("dev-only fixture scan route", () => {
  it("returns 404 for every method when NODE_ENV is production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const getResponse = await GET();
    expect(getResponse.status).toBe(404);
    const postResponse = await POST(postRequest({ fixtureId: "baseline" }));
    expect(postResponse.status).toBe(404);
  });

  it("lists the fixed fixture registry outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.fixtures).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "baseline" })]),
    );
  });

  it("runs the real scanner against the approved fixture and returns a completed report", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = await POST(postRequest({ fixtureId: "baseline" }));
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.status).toBe("completed");
    expect(report.technologies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Google Analytics",
          observation: "observed",
        }),
      ]),
    );
    expect(report.cmp).toMatchObject({ detected: true, name: "OneTrust" });
    expect(report.cookies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "dev_session", httpOnly: true }),
      ]),
    );
    for (const technology of report.technologies) {
      expect(Object.keys(technology).sort()).toEqual(
        ["category", "evidence", "name", "observation", "signature"].sort(),
      );
      // Only an id and the signature-set version may identify the rule; match
      // config (domains, path patterns) must never reach a report.
      expect(Object.keys(technology.signature ?? {}).sort()).toEqual([
        "id",
        "version",
      ]);
    }
  }, 20_000);

  it("rejects an unknown fixture id without attempting a scan", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = await POST(
      postRequest({ fixtureId: "https://example.com" }),
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.code).toBe("UNKNOWN_FIXTURE");
  });

  it("ignores any destination-shaped field other than fixtureId", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = await POST(
      postRequest({
        fixtureId: "baseline",
        url: "http://169.254.169.254/latest/meta-data/",
        fixtureOrigin: "http://169.254.169.254",
      }),
    );
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.targetUrl).not.toContain("169.254.169.254");
  }, 20_000);

  it("rejects a missing or non-string fixtureId", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const missing = await POST(postRequest({}));
    expect(missing.status).toBe(400);
    const wrongType = await POST(postRequest({ fixtureId: 123 }));
    expect(wrongType.status).toBe(400);
  });

  it("rejects a non-JSON body", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = await POST(
      new Request("http://localhost/api/dev/scan-fixture", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(response.status).toBe(400);
  });
});
