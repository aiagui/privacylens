import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { isPublicAddress } from "./ip-policy.ts";

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

/** Defense in depth only: browser egress must also be restricted outside the process. */
export async function validatePublicUrl(input: string): Promise<URL> {
  if (input.length > 2048) throw new UnsafeTargetError("URL is too long");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeTargetError("Enter an absolute HTTP or HTTPS URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UnsafeTargetError("Only HTTP and HTTPS URLs are accepted");
  }
  if (url.username || url.password)
    throw new UnsafeTargetError("Credentials in URLs are forbidden");
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new UnsafeTargetError(
      "Only standard HTTP and HTTPS ports are accepted",
    );
  }
  if (
    !url.hostname ||
    url.hostname.endsWith(".local") ||
    !url.hostname.includes(".")
  ) {
    throw new UnsafeTargetError("A public hostname is required");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(hostname)) {
    if (!isPublicAddress(hostname))
      throw new UnsafeTargetError("Non-public IP address is forbidden");
  } else {
    let addresses: { address: string; family: number }[];
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new UnsafeTargetError("Hostname cannot be resolved");
    }
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => !isPublicAddress(address))
    ) {
      throw new UnsafeTargetError(
        "Hostname resolves to a non-public IP address",
      );
    }
  }
  url.hash = "";
  return url;
}

export function validateFixtureUrl(input: string, fixtureOrigin: string): URL {
  let allowed: URL;
  try {
    allowed = new URL(fixtureOrigin);
  } catch {
    throw new UnsafeTargetError("Invalid fixture origin");
  }
  if (
    allowed.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(allowed.hostname) ||
    allowed.username ||
    allowed.password ||
    allowed.pathname !== "/" ||
    allowed.search
  ) {
    throw new UnsafeTargetError(
      "Fixture origin must be an exact loopback HTTP origin",
    );
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeTargetError("Enter an absolute fixture URL");
  }
  if (url.origin !== allowed.origin || url.protocol !== "http:") {
    throw new UnsafeTargetError(
      "Only the configured local fixture origin is allowed",
    );
  }
  if (url.username || url.password)
    throw new UnsafeTargetError("Credentials in URLs are forbidden");
  url.hash = "";
  return url;
}
