import { chromium } from "playwright";

/**
 * Set by the dedicated sandbox CI job. When true, a machine that cannot start
 * Chromium's sandbox is a hard failure, never a quiet skip.
 */
export const SANDBOX_REQUIRED = process.env.PRIVACYLENS_REQUIRE_SANDBOX === "1";

/** Whether this machine can start Chromium with its process sandbox. */
export async function sandboxAvailable(): Promise<boolean> {
  try {
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Call from beforeAll. Returns whether the sandbox can start. Where the sandbox
 * is required (the sandbox CI job) and cannot start, this throws so every test
 * in the file fails loudly. Elsewhere it prints a clear notice, so a skipped
 * sandbox test is visible in the log and not mistaken for a passed one.
 */
export async function resolveSandbox(label: string): Promise<boolean> {
  const available = await sandboxAvailable();
  if (SANDBOX_REQUIRED && !available) {
    throw new Error(
      `PRIVACYLENS_REQUIRE_SANDBOX=1 but Chromium's sandbox cannot start on this machine, so ${label} cannot validate it. See docs/ci-and-releases.md.`,
    );
  }
  if (!available) {
    console.warn(
      `[sandbox] ${label}: Chromium's sandbox cannot start here. Sandbox-dependent tests are SKIPPED, and scans in tests run with the sandbox explicitly off. They are exercised by the "Chromium sandbox tests" job.`,
    );
  }
  return available;
}
