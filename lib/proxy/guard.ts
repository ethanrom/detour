// SSRF guard for the page proxy. Every URL (the requested one and every redirect hop) must pass
// `validateUrl`, and its host must resolve only to public addresses (`resolvePublicHost`).

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ProxyError } from "./errors";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

const MAX_URL_LENGTH = 2048;
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".intranet"];

/** Default resolver: every A and AAAA record, so one private record among public ones still blocks. */
export const defaultLookup: LookupFn = async (hostname) => {
  const all = await dnsLookup(hostname, { all: true });
  return all.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

// ---- IPv4 ---------------------------------------------------------------------------------------

// [network, prefix length]
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes 255.255.255.255
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const BLOCKED_V4_INT = BLOCKED_V4.map(([net, bits]) => {
  const base = v4ToInt(net) as number;
  return { start: base, end: base + 2 ** (32 - bits) - 1 };
});

function isBlockedV4Int(n: number): boolean {
  return BLOCKED_V4_INT.some((r) => n >= r.start && n <= r.end);
}

export function isBlockedIPv4(ip: string): boolean {
  const n = v4ToInt(ip);
  return n === null ? true : isBlockedV4Int(n);
}

// ---- IPv6 ---------------------------------------------------------------------------------------

/** Eight 16-bit groups, or null when `input` is not a valid IPv6 address. */
export function parseIPv6(input: string): number[] | null {
  let ip = input;
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  if (isIP(ip) !== 6) return null;

  // Embedded dotted IPv4 tail ("::ffff:1.2.3.4") becomes two groups.
  const lastColon = ip.lastIndexOf(":");
  const tail = ip.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = v4ToInt(tail);
    if (v4 === null) return null;
    ip = `${ip.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

const embeddedV4 = (hi: number, lo: number): number => hi * 65536 + lo;

export function isBlockedIPv6(ip: string): boolean {
  const g = parseIPv6(ip);
  if (!g) return true; // unparseable: fail closed
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;

  // ::, ::1, IPv4-compatible (::a.b.c.d) and IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 0xffff)) {
    return isBlockedV4Int(embeddedV4(g6, g7));
  }
  // IPv4-translated ::ffff:0:a.b.c.d
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) {
    return isBlockedV4Int(embeddedV4(g6, g7));
  }
  // NAT64 well-known prefix 64:ff9b::/96 carries an IPv4 address; 64:ff9b:1::/48 is local-use.
  if (g0 === 0x64 && g1 === 0xff9b) {
    if (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isBlockedV4Int(embeddedV4(g6, g7));
    return true;
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if (g0 >> 8 === 0xff) return true; // ff00::/8 multicast
  if (g0 === 0x2002) return isBlockedV4Int(embeddedV4(g1, g2)); // 6to4
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo 2001::/32
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // documentation
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard-only 100::/64
  return false;
}

/** True for any IP literal in a private, loopback, link-local, multicast or otherwise special range. */
export function isBlockedIp(ip: string): boolean {
  const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  const kind = isIP(bare.includes("%") ? bare.slice(0, bare.indexOf("%")) : bare);
  if (kind === 4) return isBlockedIPv4(bare);
  if (kind === 6) return isBlockedIPv6(bare);
  return true; // not an IP at all: fail closed
}

// ---- URL and host checks ------------------------------------------------------------------------

function blockedName(host: string): boolean {
  if (host === "localhost") return true;
  if (!host.includes(".")) return true; // single-label names resolve through search domains
  return BLOCKED_SUFFIXES.some((s) => host.endsWith(s));
}

function normalisedHost(url: URL): string {
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Syntax and policy checks that need no network: http(s) only, no credentials, port 80/443 only,
 * no bare private IP and no local-looking hostname. Returns the parsed URL without its fragment.
 */
export function validateUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) {
    throw new ProxyError("bad-url", "Enter a full web address such as https://example.com/page.");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ProxyError("bad-url", "That does not look like a valid web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProxyError("bad-url", "Only http and https addresses can be analysed.");
  }
  if (url.username || url.password) {
    throw new ProxyError("bad-url", "Addresses with a username or password are not allowed.");
  }
  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    throw new ProxyError("blocked-host", "Only the standard web ports (80 and 443) are allowed.");
  }
  // WHATWG parsing already normalised decimal, octal and hex IPv4 forms ("0x7f.1" -> "127.0.0.1").
  const host = normalisedHost(url);
  if (isIP(host) !== 0) {
    if (isBlockedIp(host)) throw new ProxyError("blocked-host", "That address points to a private or internal network.");
  } else if (blockedName(host)) {
    throw new ProxyError("blocked-host", "That host name points to a private or internal network.");
  }
  url.hash = "";
  return url;
}

/**
 * Resolve the host and require every address to be public. Returns the addresses so the transport
 * can connect to exactly what was validated (no second DNS query, so no rebinding window).
 */
export async function resolvePublicHost(url: URL, lookup: LookupFn = defaultLookup): Promise<ResolvedAddress[]> {
  const host = normalisedHost(url);
  const kind = isIP(host);
  if (kind !== 0) {
    if (isBlockedIp(host)) throw new ProxyError("blocked-host", "That address points to a private or internal network.");
    return [{ address: host, family: kind === 6 ? 6 : 4 }];
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new ProxyError("fetch-failed", "That site could not be found. Check the address for typos.");
  }
  if (addresses.length === 0) throw new ProxyError("fetch-failed", "That site could not be found.");
  if (addresses.some((a) => isBlockedIp(a.address))) {
    throw new ProxyError("blocked-host", "That host name points to a private or internal network.");
  }
  return addresses;
}
