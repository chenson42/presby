/**
 * cloudflare-ranges.ts - Cloudflare's published edge address ranges, used for
 * ONE thing: noticing that a church's A/AAAA records answer from Cloudflare's
 * proxy ("orange cloud") instead of pointing at the hosting provider directly.
 * A proxied record is the commonest reason a Vercel-hosted custom domain will
 * not serve or will not issue a certificate, and the fix is a one-click change
 * at Cloudflare (set the record to "DNS only"), so the checklist names it
 * (G11, G13; operator Q7: require grey cloud for now).
 *
 * SOURCE. Cloudflare publishes these lists (the "IP Ranges" page, also served at
 * /ips-v4 and /ips-v6). They change rarely - a range has been added about once
 * every few years - and a stale list can only make the check say "not proxied"
 * for a new range, never accuse a correct record. They were written down from
 * that published list when this module was authored and have NOT been
 * re-fetched since: the monthly dependency review owns re-checking them against
 * the live list, and the real-domain acceptance pass proves the detection
 * against an actually proxied record.
 *
 * PURE: no I/O.
 */

export const CLOUDFLARE_IPV4_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
] as const;

export const CLOUDFLARE_IPV6_RANGES = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
] as const;

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i += 1) {
    const octet = Number(m[i]);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n;
}

/** True when the dotted-quad `ip` falls inside the IPv4 CIDR `cidr`. */
export function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base ?? "");
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const block = 2 ** (32 - bits);
  return Math.floor(a / block) === Math.floor(b / block);
}

/** Expands an IPv6 text address to eight 16-bit groups, or null if it is not one. */
function ipv6Groups(ip: string): number[] | null {
  const text = ip.toLowerCase().split("%")[0] ?? "";
  if (!/^[0-9a-f:.]+$/.test(text)) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = parse(halves[0] ?? "");
  const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...Array<number>(fill).fill(0), ...tail];
}

/** True when the IPv6 text address `ip` falls inside the IPv6 CIDR `cidr`. */
export function ipv6InCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const a = ipv6Groups(ip);
  const b = ipv6Groups(base ?? "");
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  let remaining = bits;
  for (let i = 0; i < 8 && remaining > 0; i += 1) {
    const take = Math.min(16, remaining);
    const shift = 16 - take;
    if (a[i]! >> shift !== b[i]! >> shift) return false;
    remaining -= take;
  }
  return true;
}

/** True when `ip` (IPv4 or IPv6 text) is inside a published Cloudflare edge range. */
export function isCloudflareAddress(ip: string): boolean {
  if (ip.includes(":")) return CLOUDFLARE_IPV6_RANGES.some((r) => ipv6InCidr(ip, r));
  return CLOUDFLARE_IPV4_RANGES.some((r) => ipv4InCidr(ip, r));
}

// ---------------------------------------------------------------------------
// Non-public addresses (the probe's SSRF pre-check)
// ---------------------------------------------------------------------------

const PRIVATE_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
] as const;

const PRIVATE_V6 = ["::/128", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8"] as const;

/** True for a loopback, private, link-local, multicast, reserved or unparseable address: somewhere the probe must never connect. */
export function isNonPublicAddress(ip: string): boolean {
  if (ip.includes(":")) {
    // IPv4-mapped (::ffff:a.b.c.d) is judged as the IPv4 address it wraps.
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
    if (mapped?.[1]) return isNonPublicAddress(mapped[1]);
    if (ipv6Groups(ip) === null) return true;
    return PRIVATE_V6.some((r) => ipv6InCidr(ip, r));
  }
  if (ipv4ToInt(ip) === null) return true;
  return PRIVATE_V4.some((r) => ipv4InCidr(ip, r));
}
