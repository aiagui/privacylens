import ipaddr from "ipaddr.js";

/** Decides whether the scanner may open a connection to an address. */
export interface AddressPolicy {
  allowAddress(address: string, port: number): boolean;
}

const DENIED_IPV6 = ["::/96", "100:0:0:1::/64"].map((cidr) =>
  ipaddr.IPv6.parseCIDR(cidr),
);

/**
 * True only for globally routable unicast addresses. Everything else is
 * refused: loopback, private, link-local (including cloud metadata), CGNAT,
 * multicast, broadcast, unspecified, reserved/documentation ranges, unique-local
 * IPv6, and transition ranges (NAT64, 6to4, Teredo) that can embed private
 * IPv4 addresses. IPv4-mapped IPv6 is unwrapped and judged as IPv4. Anything
 * that does not parse strictly, including zone identifiers, is refused.
 */
export function isPublicAddress(value: string): boolean {
  if (value.includes("%")) return false;
  const literal = value.replace(/^\[|\]$/g, "");
  // Refuse legacy IPv4 spellings ("127.1", "0x7f.1", "1.2.3") that different
  // parsers read differently; only strict dotted-quad or valid IPv6 is judged.
  // ipaddr.js reads "::1.2.3.4" as IPv4-mapped (::ffff:1.2.3.4) while RFC 4291
  // and the system resolver read it as IPv4-compatible (::102:304). Judging a
  // different address than the one dialed is unsafe, so only the standard
  // "::ffff:a.b.c.d" spelling may carry a dotted tail.
  if (
    literal.includes(":") &&
    literal.includes(".") &&
    !/^::ffff:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i.test(literal)
  )
    return false;
  const wellFormed = literal.includes(":")
    ? ipaddr.IPv6.isValid(literal)
    : ipaddr.IPv4.isValidFourPartDecimal(literal);
  if (!wellFormed) return false;
  try {
    const parsed = ipaddr.process(literal);
    // ipaddr.js calls these "unicast", but they are not globally routable:
    // IPv4-compatible ::/96 can embed 127.0.0.1 and similar, and 100:0:0:1::/64
    // is the discard-only dummy prefix (RFC 9780).
    if (
      parsed.kind() === "ipv6" &&
      DENIED_IPV6.some((range) => (parsed as ipaddr.IPv6).match(range))
    )
      return false;
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

export const publicOnlyPolicy: AddressPolicy = {
  allowAddress: (address) => isPublicAddress(address),
};
