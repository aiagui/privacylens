import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import console from "node:console";
import { createServer } from "node:net";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (chunk) => {
  output = (output + chunk).slice(-8000);
});
child.stderr.on("data", (chunk) => {
  output = (output + chunk).slice(-8000);
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Production server exited: ${output}`);
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the local server. */
    }
    await delay(250);
  }
  assert.ok(ready, `Production server did not start: ${output}`);
  const home = await fetch(origin);
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.equal(home.headers.get("referrer-policy"), "no-referrer");
  assert.equal(home.headers.get("x-powered-by"), null);
  assert.match(
    home.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  for (const path of ["/api/dev/scan-fixture", "/api/dev/scan-fixture/"]) {
    for (const method of ["GET", "POST"]) {
      const response = await fetch(`${origin}${path}`, { method });
      assert.equal(response.status, 404);
    }
  }
  const response = await fetch(`${origin}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data/" }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "SCAN_ISOLATION_REQUIRED");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const external = [];
  const errors = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) external.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("heading", { level: 1 }).waitFor();
  assert.equal(await page.locator("form").count(), 0);
  assert.match(
    await page.locator("main").innerText(),
    /public URL scanning is not available/i,
  );
  await page.getByRole("link", { name: /with sample data/ }).click();
  await page.getByRole("heading", { name: "What we observed" }).waitFor();
  assert.match(await page.getByRole("note").innerText(), /Sample data/);
  assert.match(await page.locator("main").innerText(), /sample-shop.example/);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log("Production browser smoke checks passed.");
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([stopped, delay(5000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
