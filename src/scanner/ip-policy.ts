import ipaddr from "ipaddr.js";

/** Decides whether the scanner may open a connection to an address. */
export interface AddressPolicy {
  allowAddress(address: string, port: number): boolean;
}

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
  const wellFormed = literal.includes(":")
    ? ipaddr.IPv6.isValid(literal)
    : ipaddr.IPv4.isValidFourPartDecimal(literal);
  if (!wellFormed) return false;
  try {
    return ipaddr.process(literal).range() === "unicast";
  } catch {
    return false;
  }
}

export const publicOnlyPolicy: AddressPolicy = {
  allowAddress: (address) => isPublicAddress(address),
};
