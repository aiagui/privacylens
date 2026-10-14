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

describe("endpoint matching uses whole path segments", () => {
  const ordinary = [
    "https://www.facebook.com/trending",
    "https://www.facebook.com/events/123",
    "https://www.google-analytics.com/collectibles",
    "https://www.linkedin.com/pxyz",
    "https://www.tiktok.com/events/foo",
  ];
  it.each(ordinary)("does not call %s a tracking request", (address) => {
    expect(isTrackingRequest(new URL(address), "fetch")).toBe(false);
  });

  it("does not attribute ordinary pages to a vendor by path prefix", () => {
    expect(detectTechnology(new URL(ordinary[0]!))).toBeUndefined();
    expect(detectTechnology(new URL(ordinary[2]!))).toBeUndefined();
    expect(detectTechnology(new URL(ordinary[3]!))).toBeUndefined();
  });

  it.each([
    ["https://www.facebook.com/tr?id=1", "Meta Pixel"],
    ["https://www.facebook.com/tr/", "Meta Pixel"],
    ["https://connect.facebook.net/en_US/fbevents.js", "Meta Pixel"],
    ["https://www.google-analytics.com/j/collect?v=1", "Google Analytics"],
    ["https://px.ads.linkedin.com/collect?pid=1", "LinkedIn Insight Tag"],
    ["https://stats.example.org/matomo.php?idsite=1", "Matomo"],
  ])("still recognizes %s", (address, name) => {
    expect(detectTechnology(new URL(address))?.name).toBe(name);
  });
});
