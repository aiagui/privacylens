import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { runCli } from "../src/cli/privacylens.ts";
import { scanLive } from "../src/scanner/scan-live.ts";
import { startProductionServer } from "./production-server.mjs";

/**
 * Browser test of opening a report. The report is produced by the real CLI code
 * path (runCli -> scanLive -> --out file) against a local fixture; only the
 * egress policy is injected because the CLI refuses loopback by design.
 */
const MARKER = "PL-MARKER-7f3a9c";
const work = await mkdtemp(join(tmpdir(), "pl-import-e2e-"));

// ---- 1. Produce a real report with the CLI --------------------------------
let sandbox = true;
try {
  const probe = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  await probe.close();
} catch {
  sandbox = false;
  console.log(
    "NOTE: Chromium's sandbox cannot start here; the fixture scan runs with it explicitly off (the sandbox CI job covers it).",
  );
}
let fixturePort = 0;
const fixture = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/matomo.php")
    return void res
      .writeHead(204, { "access-control-allow-origin": "*" })
      .end();
  res.writeHead(200, {
    "content-type": "text/html",
    "set-cookie": "visit_count=3; Path=/; SameSite=Lax",
  });
  res.end(`<!doctype html><title>Fixture</title><div id="onetrust-banner-sdk">c</div>
    <script>
      fetch("http://stats.example:${fixturePort}/matomo.php?idsite=1", { mode: "no-cors" }).catch(() => {});
      fetch("http://cdn.example:${fixturePort}/lib.js").catch(() => {});
      fetch("http://127.0.0.1:8081/internal").catch(() => {});
    </script>`);
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
fixturePort = fixture.address().port;
const cliReportPath = join(work, "cli-report.json");
const exit = await runCli(
  [
    "scan",
    `http://site.example:${fixturePort}/`,
    "--out",
    cliReportPath,
    "--settle",
    "1",
  ],
  {
    stdout: () => undefined,
    stderr: () => undefined,
    version: "0.1.0",
    scan: (target, options) =>
      scanLive(target, {
        ...options,
        chromiumSandbox: sandbox,
        egress: {
          policy: {
            allowAddress: (a, p) => a === "127.0.0.1" && p === fixturePort,
          },
          resolve: async () => [{ address: "127.0.0.1", family: 4 }],
        },
      }),
  },
);
assert.equal(exit, 0, "the CLI must produce a report");
await new Promise((resolve) => fixture.close(resolve));
const cliReport = JSON.parse(await readFile(cliReportPath, "utf8"));
assert.equal(cliReport.schemaVersion, 1);

// ---- 2. Other files to try ------------------------------------------------
const hostile = JSON.parse(JSON.stringify(cliReport));
const evil = [
  `<img src="https://evil.example/pixel.png" onerror="window.__pwned=1"> ${MARKER}`,
  `<script>window.__pwned=1</script> ${MARKER}`,
  `javascript:window.__pwned=1 ${MARKER}`,
  `[link](https://evil.example/) ${MARKER}`,
];
hostile.technologies = hostile.technologies.map((t, i) => ({
  ...t,
  name: evil[i % evil.length],
  evidence: [evil[(i + 1) % evil.length]],
}));
hostile.concerns = [{ title: evil[0], detail: evil[3], level: "attention" }];
hostile.limitations = [evil[1], evil[2]];
hostile.cmp = { detected: true, name: evil[3], evidence: evil[0] };
// Long unbroken strings in every free-text field, and a maximum-size report.
const token = (n) => "A".repeat(n);
const longTokens = JSON.parse(JSON.stringify(cliReport));
longTokens.technologies = longTokens.technologies.map((t) => ({
  ...t,
  name: token(200),
  evidence: [token(2000)],
}));
longTokens.cookies = [
  {
    name: token(300),
    domain: token(250),
    firstParty: true,
    secure: true,
    httpOnly: false,
  },
  ...longTokens.cookies,
];
longTokens.concerns = [
  { title: token(200), detail: token(2000), level: "attention" },
];
longTokens.limitations = [token(2000)];
longTokens.cmp = { detected: true, name: token(100), evidence: token(200) };
longTokens.provenance.egress.blockedDestinations = [
  { host: token(300), port: 80, reason: "non-public-address" },
];
const heavy = JSON.parse(JSON.stringify(cliReport));
const template = heavy.thirdPartyRequests[0];
heavy.thirdPartyRequests = Array.from({ length: 2500 }, (_, i) => ({
  ...template,
  timeMs: i,
}));
heavy.cookies = Array.from({ length: 500 }, (_, i) => ({
  name: `cookie_${i}`,
  domain: "site.example",
  firstParty: true,
  secure: true,
  httpOnly: false,
}));
const files = {
  longTokens: join(work, "long-tokens.json"),
  heavy: join(work, "heavy.json"),
  cli: cliReportPath,
  hostile: join(work, "hostile.json"),
  notJson: join(work, "not-json.json"),
  version2: join(work, "version2.json"),
  noVersion: join(work, "no-version.json"),
  extraField: join(work, "extra.json"),
  empty: join(work, "empty.json"),
  big: join(work, "big.json"),
};
await writeFile(files.hostile, JSON.stringify(hostile));
await writeFile(files.longTokens, JSON.stringify(longTokens));
await writeFile(files.heavy, JSON.stringify(heavy));
await writeFile(files.notJson, "this is not json {");
await writeFile(
  files.version2,
  JSON.stringify({ ...cliReport, schemaVersion: 2 }),
);
const withoutVersion = { ...cliReport };
delete withoutVersion.schemaVersion;
await writeFile(files.noVersion, JSON.stringify(withoutVersion));
await writeFile(
  files.extraField,
  JSON.stringify({ ...cliReport, __proto__: undefined, injected: `${MARKER}` }),
);
await writeFile(files.empty, "");
await writeFile(files.big, Buffer.alloc(6 * 1024 * 1024, 0x20));

// ---- 3. Drive the production build ---------------------------------------
const server = await startProductionServer();
const { origin } = server;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const requests = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.on("request", (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData() ?? "",
      type: request.resourceType(),
    }),
  );
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const openFile = async (path) => {
    await page.locator("#report-file").setInputFiles(path);
  };
  // textContent, so both views count: the inactive one is hidden, not removed.
  const reportMain = () => page.locator("main").textContent();
  const showView = (name) => page.getByRole("tab", { name }).click();

  // The home page links to the importer.
  await page.goto(origin);
  await page.getByRole("link", { name: /Open a CLI report/ }).click();
  await page.waitForURL(`${origin}/import`);
  await page
    .getByRole("heading", { level: 1, name: /Explore a report/ })
    .waitFor();

  // CSP header and enforcement.
  const csp = (await fetch(`${origin}/import`)).headers.get(
    "content-security-policy",
  );
  for (const directive of [
    "connect-src 'self'",
    "img-src 'self' data:",
    "form-action 'none'",
    "frame-src 'none'",
  ])
    assert.ok(csp.includes(directive), `CSP must include ${directive}: ${csp}`);
  const violation = await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.document.addEventListener(
          "securitypolicyviolation",
          (event) => resolve(event.violatedDirective),
          { once: true },
        );
        new globalThis.Image().src = "https://evil.example/pixel.png";
        globalThis.setTimeout(() => resolve("none"), 1500);
      }),
  );
  assert.match(
    String(violation),
    /img-src/,
    "the CSP must block an external image",
  );
  const afterCsp = requests.length;

  // Accessible structure of the empty state.
  assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
  assert.equal(
    await page.locator("form").count(),
    0,
    "no form element: nothing can be submitted",
  );
  const label = page.locator('label[for="report-file"]');
  assert.equal(await label.innerText(), "Choose a report file");
  for (const id of ["import-privacy", "import-limits"])
    assert.equal(await page.locator(`#${id}`).count(), 1);
  assert.match(
    await page.locator("#import-privacy").innerText(),
    /stays in this browser tab/,
  );

  // Keyboard: the input is reachable, shows a visible focus ring, and opens the chooser.
  await page.keyboard.press("Tab"); // skip link
  for (let i = 0; i < 8; i++) {
    if (
      (await page.evaluate(() => globalThis.document.activeElement?.id)) ===
      "report-file"
    )
      break;
    await page.keyboard.press("Tab");
  }
  assert.equal(
    await page.evaluate(() => globalThis.document.activeElement?.id),
    "report-file",
  );
  const outline = await label.evaluate((el) => {
    const style = globalThis.getComputedStyle(el);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  assert.notEqual(outline.style, "none", "keyboard focus must be visible");
  assert.equal(outline.width, "3px");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.keyboard.press("Space"),
  ]);
  await chooser.setFiles(files.cli);
  await page
    .getByRole("heading", { level: 1, name: /What we observed/ })
    .waitFor();

  // ---- A real CLI report is displayed through the real components ----
  assert.equal(
    await page.evaluate(() => globalThis.document.activeElement?.tagName),
    "H1",
    "focus moves to the report",
  );
  const text = await reportMain();
  assert.match(text, /Imported report\./);
  assert.match(text, /cannot verify who produced it/);
  assert.match(text, /IMPORTED INSPECTION/);
  assert.match(text, /Matomo/);
  for (const label of ["OBSERVED", "UNKNOWN"])
    assert.match(text, new RegExp(label));
  assert.match(text, /Completed|Failed|Refused by filter/);
  assert.match(text, /How this report was collected/);
  assert.match(text, /Browser sandbox/i);
  assert.match(text, /OneTrust/);
  assert.match(text, new RegExp(`http://site\\.example:${fixturePort}`));
  assert.equal(
    await page.getByRole("button", { name: /Close this report/ }).count(),
    1,
  );
  // The interactive request journey works on imported data.
  await showView(/Technical view/);
  const destinations = page.locator(".destination-list button");
  assert.ok((await destinations.count()) >= 2);
  await destinations.nth(1).click();
  assert.equal(await destinations.nth(1).getAttribute("aria-pressed"), "true");
  assert.match(await page.locator(".journey-detail").innerText(), /EVIDENCE/);
  assert.match(await page.locator(".journey-detail").innerText(), /OUTCOME/);

  // Nothing was sent anywhere or stored.
  const afterImport = requests.slice(afterCsp);
  for (const request of afterImport) {
    assert.equal(
      new URL(request.url).origin,
      origin,
      `external request: ${request.url}`,
    );
    assert.equal(
      request.method,
      "GET",
      `non-GET request: ${request.method} ${request.url}`,
    );
    assert.equal(request.body, "", "a request carried a body");
    assert.ok(
      !/site\.example|stats\.example|cdn\.example|visit_count/.test(
        request.url,
      ),
      `report data in a URL: ${request.url}`,
    );
  }
  const storage = await page.evaluate(async () => ({
    local: globalThis.localStorage.length,
    session: globalThis.sessionStorage.length,
    cookie: globalThis.document.cookie,
    idb: (await globalThis.indexedDB.databases()).length,
    caches: (await globalThis.caches.keys()).length,
    workers: (await globalThis.navigator.serviceWorker.getRegistrations())
      .length,
  }));
  assert.deepEqual(storage, {
    local: 0,
    session: 0,
    cookie: "",
    idb: 0,
    caches: 0,
    workers: 0,
  });
  assert.deepEqual(await context.cookies(), [], "no cookie may be set");

  // Responsive: no horizontal overflow with a real report, on phones.
  for (const [w, h] of [
    [390, 844],
    [320, 720],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    assert.ok(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
      `report page must fit ${w}px`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  const screenshotDir = process.env.PRIVACYLENS_SCREENSHOT_DIR;
  // Capture from a settled page: no focus ring or scroll offset left over from
  // the checks above, and layout finished after each resize.
  const capture = async (name, width, height) => {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      globalThis.document.activeElement?.blur?.();
      globalThis.scrollTo(0, 0);
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(screenshotDir, name), fullPage: true });
  };
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await capture("import-report-desktop.png", 1440, 1000);
    await capture("import-report-mobile.png", 390, 844);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(300);
  }

  // Closing discards the report and returns to the importer.
  await page.getByRole("button", { name: /Close this report/ }).click();
  await page
    .getByRole("heading", { level: 1, name: /Explore a report/ })
    .waitFor();
  assert.doesNotMatch(await reportMain(), /Matomo/);
  assert.equal(
    await page.evaluate(() => globalThis.document.activeElement?.id),
    "report-file",
  );

  // ---- Problem files each give a clear, announced error, then recover ----
  const problems = [
    [files.notJson, /not valid JSON/],
    [files.empty, /empty/],
    [files.big, /too large/],
    [files.version2, /newer than the version 1/],
    [files.noVersion, /schemaVersion/],
    [files.extraField, /not a known field/],
  ];
  for (const [path, pattern] of problems) {
    await openFile(path);
    const alert = page.locator(".import-error");
    await alert.waitFor();
    assert.match(await alert.innerText(), pattern, `error for ${path}`);
    assert.match(await alert.innerText(), /Nothing from the file was kept/);
    assert.equal(
      await page.evaluate(() =>
        globalThis.document.activeElement?.getAttribute("role"),
      ),
      "alert",
      "focus moves to the error",
    );
    assert.doesNotMatch(
      await alert.innerText(),
      new RegExp(MARKER),
      "error text must not echo file content",
    );
    assert.equal(await page.locator(".report").count(), 0);
  }
  // The picker accepts one file; two can only arrive by dropping.
  await page.evaluate(() => {
    const transfer = new globalThis.DataTransfer();
    transfer.items.add(
      new globalThis.File(["{}"], "a.json", { type: "application/json" }),
    );
    transfer.items.add(
      new globalThis.File(["{}"], "b.json", { type: "application/json" }),
    );
    globalThis.document.querySelector(".import-drop").dispatchEvent(
      new globalThis.DragEvent("drop", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assert.match(
    await page.locator(".import-error").innerText(),
    /one report file at a time/,
  );
  await openFile(files.cli);
  await page
    .getByRole("heading", { level: 1, name: /What we observed/ })
    .waitFor();
  await page.getByRole("button", { name: /Close this report/ }).click();
  await page
    .getByRole("heading", { level: 1, name: /Explore a report/ })
    .waitFor();

  // ---- Drag and drop ----
  const bytes = await readFile(files.cli);
  await page.evaluate(async (content) => {
    const transfer = new globalThis.DataTransfer();
    transfer.items.add(
      new globalThis.File([content], "dropped.json", {
        type: "application/json",
      }),
    );
    const zone = globalThis.document.querySelector(".import-drop");
    zone.dispatchEvent(
      new globalThis.DragEvent("dragover", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
    zone.dispatchEvent(
      new globalThis.DragEvent("drop", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, bytes.toString("utf8"));
  await page
    .getByRole("heading", { level: 1, name: /What we observed/ })
    .waitFor();
  assert.match(await reportMain(), /dropped\.json/);
  await page.getByRole("button", { name: /Close this report/ }).click();
  await page
    .getByRole("heading", { level: 1, name: /Explore a report/ })
    .waitFor();

  // ---- Hostile content is shown as text and does nothing ----
  const before = requests.length;
  await openFile(files.hostile);
  await page
    .getByRole("heading", { level: 1, name: /What we observed/ })
    .waitFor();
  const hostileText = await reportMain();
  assert.match(
    hostileText,
    /<script>window\.__pwned=1<\/script>/,
    "hostile markup must appear as literal text",
  );
  assert.match(hostileText, new RegExp(MARKER));
  assert.equal(
    await page.evaluate(() => globalThis.__pwned),
    undefined,
    "no imported script may run",
  );
  assert.equal(
    await page
      .locator(
        ".report img, .report script, .report iframe, .report object, .report embed",
      )
      .count(),
    0,
  );
  assert.equal(
    await page.locator('.report a[href]:not([href^="#"])').count(),
    0,
    "report links are in-page anchors only",
  );
  assert.equal(
    await page
      .locator(
        ".report [src], .report [srcset], .report [onerror], .report [onload], .report [style]",
      )
      .count(),
    0,
  );
  await page.waitForTimeout(1000);
  assert.equal(page.url(), `${origin}/import`, "the page must not navigate");
  for (const request of requests.slice(before)) {
    assert.equal(
      new URL(request.url).origin,
      origin,
      `external request: ${request.url}`,
    );
    assert.equal(request.method, "GET");
    assert.ok(!request.url.includes(MARKER) && !request.body.includes(MARKER));
  }
  // A reload leaves nothing behind.
  await page.reload();
  await page
    .getByRole("heading", { level: 1, name: /Explore a report/ })
    .waitFor();
  assert.doesNotMatch(await reportMain(), new RegExp(MARKER));

  // ---- A slow read of an earlier choice must not overwrite a later one ----
  await page.reload();
  await page
    .getByRole("heading", { level: 1, name: /Explore a report/ })
    .waitFor();
  await page.evaluate(() => {
    const original = globalThis.File.prototype.text;
    let calls = 0;
    globalThis.File.prototype.text = function () {
      calls += 1;
      return calls === 1
        ? new Promise((resolve) =>
            globalThis.setTimeout(() => resolve(original.call(this)), 1200),
          )
        : original.call(this);
    };
  });
  await openFile(files.cli); // read stalls for 1.2 s
  await page.waitForTimeout(150);
  await openFile(files.notJson); // chosen later, finishes first
  await page.locator(".import-error").waitFor();
  await page.waitForTimeout(1800); // the stalled read finishes now
  assert.equal(
    await page.locator(".report").count(),
    0,
    "a stale read must not open its report",
  );
  assert.match(
    await page.locator(".import-error").innerText(),
    /not valid JSON/,
  );
  await page.reload();
  await page
    .getByRole("heading", { level: 1, name: /Explore a report/ })
    .waitFor();

  // ---- Long unbroken strings wrap instead of widening the page ----
  await openFile(files.longTokens);
  await page
    .getByRole("heading", { level: 1, name: /What we observed/ })
    .waitFor();
  for (const [w, h] of [
    [1440, 1000],
    [390, 844],
    [320, 720],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const view of [/Simple view/, /Technical view/]) {
      await showView(view);
      const overflow = await page.evaluate(() => ({
        scroll: globalThis.document.documentElement.scrollWidth,
        inner: globalThis.innerWidth,
      }));
      assert.ok(
        overflow.scroll <= overflow.inner,
        `long strings must not overflow at ${w}px: ${overflow.scroll} > ${overflow.inner}`,
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /Close this report/ }).click();
  await page
    .getByRole("heading", { level: 1, name: /Explore a report/ })
    .waitFor();

  // ---- A report with the most requests the scanner can write stays usable ----
  const loadStart = Date.now();
  await openFile(files.heavy);
  await page
    .getByRole("heading", { level: 1, name: /What we observed/ })
    .waitFor();
  const loadMs = Date.now() - loadStart;
  assert.ok(
    loadMs < 8000,
    `a large report must open promptly (took ${loadMs} ms)`,
  );
  assert.ok(
    (await page.locator(".destination-list button").count()) <= 100,
    "the timeline is bounded",
  );
  await showView(/Technical view/);
  assert.match(await page.locator(".journey-panel").innerText(), /first 100/);
  const closeStart = Date.now();
  await page.getByRole("button", { name: /Close this report/ }).click();
  await page
    .getByRole("heading", { level: 1, name: /Explore a report/ })
    .waitFor();
  const closeMs = Date.now() - closeStart;
  assert.ok(
    closeMs < 1500,
    `closing a large report must not freeze the page (took ${closeMs} ms)`,
  );

  // Phone layout of the empty importer and of an error.
  for (const [w, h] of [
    [390, 844],
    [320, 720],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await openFile(files.notJson);
    await page.locator(".import-error").waitFor();
    assert.ok(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
      `importer must fit ${w}px`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (screenshotDir) {
    await page.reload();
    await page
      .getByRole("heading", { level: 1, name: /Explore a report/ })
      .waitFor();
    await capture("import-empty-desktop.png", 1440, 1000);
  }

  const unexpectedExternal = requests.filter(
    (r) =>
      new URL(r.url).origin !== origin &&
      !r.url.startsWith("data:") &&
      !r.url.includes("evil.example/pixel.png"),
  );
  assert.deepEqual(
    unexpectedExternal,
    [],
    "no external request may be made by the importer",
  );
  assert.deepEqual(pageErrors, []);
  // The one deliberate CSP probe above is the only console error allowed.
  assert.ok(
    consoleErrors.every((m) => /Content Security Policy|evil\.example/.test(m)),
    `unexpected console errors: ${consoleErrors.join(" | ")}`,
  );
  console.log("Report import browser checks passed.");
} finally {
  await browser?.close();
  await server.stop();
  await rm(work, { recursive: true, force: true });
}
