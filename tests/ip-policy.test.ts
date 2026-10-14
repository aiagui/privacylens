import { describe, expect, it } from "vitest";
import { isPublicAddress } from "../src/scanner/ip-policy";

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])("allows global unicast %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["loopback range", "127.255.255.254"],
    ["this network", "0.0.0.0"],
    ["private 10/8", "10.0.0.1"],
    ["private 172.16/12", "172.16.0.1"],
    ["private 172.31", "172.31.255.255"],
    ["private 192.168/16", "192.168.1.1"],
    ["link-local", "169.254.1.1"],
    ["cloud metadata", "169.254.169.254"],
    ["CGNAT", "100.64.0.1"],
    ["multicast", "224.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["reserved class E", "240.0.0.1"],
    ["documentation TEST-NET-1", "192.0.2.1"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unspecified", "::"],
    ["IPv6 unique-local", "fd00::1"],
    ["IPv6 metadata (AWS)", "fd00:ec2::254"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv6 multicast", "ff02::1"],
    ["IPv6 documentation", "2001:db8::1"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped private", "::ffff:10.0.0.1"],
    ["IPv4-mapped metadata", "::ffff:169.254.169.254"],
    ["IPv4-mapped hex form", "::ffff:7f00:1"],
    ["NAT64 embedding loopback", "64:ff9b::7f00:1"],
    ["NAT64 embedding metadata", "64:ff9b::a9fe:a9fe"],
    ["6to4 embedding loopback", "2002:7f00:1::1"],
    ["Teredo", "2001:0:4136:e378:8000:63bf:3fff:fdd2"],
    ["IPv4-compatible loopback", "::7f00:1"],
    ["IPv4-compatible private", "::a00:1"],
    ["IPv4-compatible metadata", "::a9fe:a9fe"],
    ["IPv4-compatible dotted", "::1.2.3.4"],
    ["IPv6 dummy prefix RFC 9780", "100:0:0:1::1"],
    ["NAT64 with dotted tail", "64:ff9b::8.8.8.8"],
    ["full-form mapped with dotted tail", "0:0:0:0:0:ffff:127.0.0.1"],
    ["IPv4-compatible dotted loopback", "::127.0.0.1"],
  ])("refuses %s (%s)", (_name, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    "",
    "localhost",
    "not-an-ip",
    "fe80::1%eth0",
    "8.8.8.8%lo",
    "256.1.1.1",
    "1.2.3",
  ])("refuses unparseable or zoned input %j", (value) => {
    expect(isPublicAddress(value)).toBe(false);
  });

  it("still judges the standard IPv4-mapped spelling by its embedded address", () => {
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
  });

  it("accepts bracketed IPv6 literals as URLs produce them", () => {
    expect(isPublicAddress("[2606:4700:4700::1111]")).toBe(true);
    expect(isPublicAddress("[::1]")).toBe(false);
  });

  it("is not fooled by alternate IPv4 spellings once the URL parser normalizes them", () => {
    // WHATWG URL rewrites these to dotted decimal before any policy runs.
    for (const spelling of [
      "http://2130706433/",
      "http://0x7f.1/",
      "http://0177.0.0.1/",
      "http://127.1/",
    ]) {
      expect(isPublicAddress(new URL(spelling).hostname), spelling).toBe(false);
    }
  });
});
