import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanFixture } from "../src/scanner/scan-fixture";

let origin: string;
let redirectedOrigin: string;
let redirectedHits = 0;
let sameOriginRedirectHits = 0;
const redirectedServer = createServer((_request, response) => {
  redirectedHits += 1;
  response.end("unexpected");
});
const server = createServer((request, response) => {
  if (request.url === "/redirect") {
    response.writeHead(302, {
      Location: `${redirectedOrigin}/unexpected`,
    });
    response.end();
    return;
  }
  if (request.url === "/asset-redirect") {
    response.writeHead(302, { Location: `${redirectedOrigin}/unexpected` });
    response.end();
    return;
  }
  if (request.url === "/page-with-asset-redirect") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<!doctype html><img src="/asset-redirect">');
    return;
  }
  if (request.url === "/same-origin-redirect") {
    response.writeHead(302, { Location: "/redirect-target" });
    response.end();
    return;
  }
  if (request.url === "/redirect-target") sameOriginRedirectHits += 1;
  if (request.url === "/not-found") {
    response.writeHead(404);
    response.end("synthetic missing page");
    return;
  }
  if (request.url === "/server-error") {
    response.writeHead(500);
    response.end("synthetic server error");
    return;
  }
  if (request.url === "/ordinary-pages") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><title>Ordinary</title><script>
      for (const url of [
        "https://www.facebook.com/trending",
        "https://www.facebook.com/events/123",
        "https://www.google-analytics.com/collectibles",
        "https://www.linkedin.com/pxyz",
        "https://www.tiktok.com/events/foo",
      ]) fetch(url).catch(() => {});
    </script>`);
    return;
  }
  if (request.url === "/script-only") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      '<!doctype html><script src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>',
    );
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Set-Cookie": "essential=yes; HttpOnly; SameSite=Lax; Path=/",
  });
  response.end(`<!doctype html><title>Fixture</title>
    <div id="onetrust-banner-sdk">Consent</div>
    <script src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>
    <script>fetch("https://www.google-analytics.com/g/collect?cid=private-token").catch(() => {});</script>`);
});

beforeAll(async () => {
  await new Promise<void>((resolve) =>
    redirectedServer.listen(0, "127.0.0.1", resolve),
  );
  const redirectedAddress = redirectedServer.address();
  if (!redirectedAddress || typeof redirectedAddress === "string")
    throw new Error("No redirect fixture port");
  redirectedOrigin = `http://127.0.0.1:${redirectedAddress.port}`;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => redirectedServer.close(() => resolve()));
});

describe("browser fixture scan", () => {
  it("does not label a script-only request as observed tracking", async () => {
    const report = await scanFixture(`${origin}/script-only`, origin);
    expect(report.technologies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Google Tag Manager",
          observation: "inferred",
        }),
      ]),
    );
    expect(report.concerns).toEqual([]);
  }, 20_000);

  it("does not raise a tracking concern for ordinary third-party requests", async () => {
    const report = await scanFixture(`${origin}/ordinary-pages`, origin);
    expect(report.thirdPartyRequests.length).toBeGreaterThanOrEqual(5);
    expect(report.concerns).toEqual([]);
    expect(
      report.technologies.filter((tech) => tech.observation === "observed"),
    ).toEqual([]);
    expect(
      report.thirdPartyRequests.every(
        (request) => request.classification === "unknown",
      ),
    ).toBe(true);
    expect(report.signatureSetVersion).toBeTruthy();
  }, 20_000);

  it("still raises the concern for a genuine collection request", async () => {
    const report = await scanFixture(origin, origin);
    expect(report.concerns).toEqual([
      expect.objectContaining({
        title: "Tracking before interaction",
        level: "attention",
      }),
    ]);
  }, 20_000);

  it("records pre-interaction evidence without leaking cookie values or query strings", async () => {
    const report = await scanFixture(origin, origin);
    expect(report.cookies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "essential",
          httpOnly: true,
          firstParty: true,
        }),
      ]),
    );
    expect(report.cmp).toMatchObject({ detected: true, name: "OneTrust" });
    expect(report.technologies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Google Analytics",
          observation: "observed",
        }),
      ]),
    );
    expect(
      report.thirdPartyRequests.some(
        (request) => request.domain === "www.google-analytics.com",
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("private-token");
    expect(JSON.stringify(report)).not.toContain("essential=yes");
  }, 20_000);

  it.each(["not-found", "server-error"])(
    "does not report a %s response as a completed scan",
    async (path) => {
      await expect(scanFixture(`${origin}/${path}`, origin)).rejects.toThrow(
        "successful fixture response",
      );
    },
    20_000,
  );

  it("blocks same-origin redirects rather than silently following them", async () => {
    await expect(
      scanFixture(`${origin}/same-origin-redirect`, origin),
    ).rejects.toThrow();
    expect(sameOriginRedirectHits).toBe(0);
  }, 20_000);

  it("blocks subresource redirects without failing a successful document", async () => {
    const report = await scanFixture(
      `${origin}/page-with-asset-redirect`,
      origin,
    );
    expect(report.status).toBe("completed");
    expect(redirectedHits).toBe(0);
    expect(report.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("HTTP redirects are blocked"),
      ]),
    );
  }, 20_000);

  it("blocks cross-origin redirects before they reach the destination", async () => {
    await expect(scanFixture(`${origin}/redirect`, origin)).rejects.toThrow();
    expect(redirectedHits).toBe(0);
  }, 20_000);
});
