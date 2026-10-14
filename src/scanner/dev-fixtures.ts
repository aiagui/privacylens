import { createServer, type Server } from "node:http";
import { scanFixture } from "./scan-fixture";
import type { ScanReport } from "./types";

export class UnknownFixtureError extends Error {
  constructor(fixtureId: string) {
    super(`Unknown development fixture: "${fixtureId}"`);
    this.name = "UnknownFixtureError";
  }
}

interface DevFixture {
  label: string;
  description: string;
  html: string;
}

// Every fixture is fixed, bundled HTML served by a server this module
// creates itself. There is no way to pass a URL into a scan from the
// outside: callers choose one of these IDs, nothing else.
const DEV_FIXTURES: Record<string, DevFixture> = {
  baseline: {
    label: "Tracker-heavy page with a consent banner",
    description:
      "Loads Google Tag Manager, a Google Analytics collection request, and a Meta Pixel request alongside a OneTrust consent banner and a first-party cookie.",
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Development fixture</title>
  </head>
  <body>
    <div id="onetrust-banner-sdk">Consent</div>
    <script src="https://www.googletagmanager.com/gtag/js?id=G-DEVFIXTURE"></script>
    <script>
      fetch("https://www.google-analytics.com/g/collect?cid=dev-fixture").catch(() => {});
      fetch("https://www.facebook.com/tr?id=dev-fixture").catch(() => {});
    </script>
  </body>
</html>`,
  },
};

export function listDevFixtures(): Array<{
  id: string;
  label: string;
  description: string;
}> {
  return Object.entries(DEV_FIXTURES).map(([id, fixture]) => ({
    id,
    label: fixture.label,
    description: fixture.description,
  }));
}

/**
 * Serves a hardcoded fixture on an ephemeral loopback-only HTTP server and
 * runs the real scanner against it. `fixtureId` selects bundled HTML; it is
 * never a URL, so no caller-supplied destination can reach the scanner here.
 */
export async function runDevFixtureScan(
  fixtureId: string,
): Promise<ScanReport> {
  if (!Object.hasOwn(DEV_FIXTURES, fixtureId)) {
    throw new UnknownFixtureError(fixtureId);
  }
  const fixture = DEV_FIXTURES[fixtureId];
  if (!fixture) throw new UnknownFixtureError(fixtureId);

  const server: Server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": "dev_session=fixture; HttpOnly; SameSite=Lax; Path=/",
    });
    response.end(fixture.html);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Development fixture server failed to bind a port");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    return await scanFixture(origin, origin);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
