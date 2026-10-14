import { describe, expect, it } from "vitest";
import {
  detectTechnology,
  isThirdParty,
  isTrackingRequest,
  safeDestination,
} from "../src/scanner/detectors";

describe("tracking detection", () => {
  it("distinguishes script from collection request", () => {
    const script = new URL("https://www.googletagmanager.com/gtag/js?id=G-ABC");
    const request = new URL(
      "https://www.google-analytics.com/g/collect?v=2&cid=secret",
    );
    expect(detectTechnology(script)?.name).toBe("Google Tag Manager");
    expect(isTrackingRequest(script, "script")).toBe(false);
    expect(detectTechnology(request)?.name).toBe("Google Analytics");
    expect(isTrackingRequest(request, "fetch")).toBe(true);
    expect(safeDestination(request)).toBe("https://www.google-analytics.com");
  });

  it("classifies related subdomains as first party", () => {
    expect(isThirdParty("shop.example.co.uk", "cdn.example.co.uk")).toBe(false);
    expect(isThirdParty("shop.example.co.uk", "google-analytics.com")).toBe(
      true,
    );
  });

  it("never leaks internal signature config (domains, path regex) into a finding", () => {
    const request = new URL(
      "https://www.google-analytics.com/g/collect?v=2&cid=secret",
    );
    expect(Object.keys(detectTechnology(request) ?? {}).sort()).toEqual([
      "category",
      "name",
    ]);
  });
});
