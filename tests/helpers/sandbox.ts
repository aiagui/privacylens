import { chromium } from "playwright";

/**
 * Whether this machine can start Chromium with its process sandbox. Some CI
 * hosts restrict unprivileged user namespaces; tests that scan then say so
 * explicitly instead of silently depending on the host.
 */
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
