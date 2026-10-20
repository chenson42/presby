import "server-only";
import { domainToASCII, domainToUnicode } from "node:url";
import { isPlatformHost, platformHosts } from "./host";

/**
 * The G2 hostname rules (docs/work-log/2026-10-19-custom-domains.md, Phase 3
 * "Rulings on the [D] gaps", G2): turn whatever an admin typed into the
 * punycode claim name and the set of hostnames to hold, or refuse it with a
 * reason the action can map to a field message.
 *
 * THE PIPELINE, in order, and each step is a refusal point:
 *   trim -> reject whitespace/control/format characters and `%` -> lowercase
 *   -> strip an http(s):// scheme -> cut at the first `/ ? # \` -> reject if an
 *   `@` remains -> strip a `:port` and ONE trailing dot -> reject a wildcard ->
 *   `domainToASCII` (empty means invalid) -> round-trip through
 *   `domainToUnicode` (a malformed punycode label does not survive) -> length
 *   <= 253, labels 1-63 of `[a-z0-9-]` neither starting nor ending with `-`,
 *   at least two labels -> reject an IP literal (a numeric last label, which
 *   also catches the forms a URL parser normalizes to one) -> reject our own
 *   platform hosts, any subdomain of a platform apex, `*.vercel.app`,
 *   `localhost` and the special-use TLDs (unless DOMAINS_ALLOW_RESERVED_TLDS=1
 *   - the e2e/dev allowance the production build asserts is unset) -> reject a
 *   label whose letters span more than one Unicode script.
 *
 * NO PUBLIC-SUFFIX LIST (Phase 2): a suffix-only name such as `co.uk` can never
 * prove control, so its claim simply expires after 7 days; the TXT proof is the
 * security control. The database CHECKs on `hostname` / `claim_name` are the
 * backstop for the SHAPE (drizzle/0057 section 2).
 *
 * THE APEX/WWW PAIR (G4). A typed apex yields the apex row plus `www.<apex>`;
 * a typed `www.`-prefixed name yields that one row only (a proof at `www.N`
 * covers only itself, R10). Without a suffix list "apex" is a heuristic:
 * exactly two labels, or three labels where the second is a well-known
 * registry label under a two-letter country code (`church.co.uk`). The
 * heuristic is a CONVENIENCE and is wrong in neither direction harmfully: if
 * it pairs a name that is really a subdomain the admin removes the extra row,
 * and if it misses a real apex the admin claims `www.` as its own name. The
 * proof, not the guess, decides what is held. Named residual.
 */

export type ClaimRefusal =
  | "empty"
  | "too_long"
  | "invalid_characters"
  | "invalid_format"
  | "credentials"
  | "wildcard"
  | "ip_address"
  | "too_few_labels"
  | "reserved"
  | "mixed_script";

export type NormalizedClaim =
  | {
      ok: true;
      /** The name the admin typed, as punycode; the TXT sits at `_presby-challenge.<claimName>`. */
      claimName: string;
      /** The Unicode form for display. */
      displayName: string;
      /** The hostnames to hold: `[claimName]` or `[claimName, "www." + claimName]`. */
      hostnames: string[];
      /** True when the pair (apex + www) is offered. */
      pairable: boolean;
    }
  | { ok: false; reason: ClaimRefusal };

type EnvLike = Readonly<Record<string, string | undefined>>;

const MAX_RAW_LENGTH = 2048;
const MAX_HOST_LENGTH = 253;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Special-use / non-delegable TLDs (RFC 6761/6762/7686 and the common private ones). */
const RESERVED_TLDS = new Set([
  "invalid",
  "test",
  "example",
  "localhost",
  "local",
  "internal",
  "onion",
  "arpa",
  "home",
  "corp",
  "lan",
  "intranet",
  "private",
  "alt",
]);

/** Second-level registry labels that make a three-label name an apex under a ccTLD. */
const REGISTRY_LABELS = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "or", "ne", "go"]);

// Scripts a domain label may legitimately use. A letter in none of them still
// counts as its own "unknown" script, so mixing it with Latin is refused.
const SCRIPTS = [
  "Latin",
  "Cyrillic",
  "Greek",
  "Han",
  "Hiragana",
  "Katakana",
  "Hangul",
  "Arabic",
  "Hebrew",
  "Devanagari",
  "Thai",
  "Armenian",
  "Georgian",
  "Bengali",
  "Tamil",
  "Telugu",
  "Ethiopic",
] as const;
const SCRIPT_RES = SCRIPTS.map((name) => ({
  name,
  re: new RegExp(`^\\p{Script=${name}}$`, "u"),
}));

function scriptOf(char: string): string {
  for (const { name, re } of SCRIPT_RES) if (re.test(char)) return name;
  return `unknown:${char}`;
}

function mixedScript(unicodeLabel: string): boolean {
  const seen = new Set<string>();
  for (const char of unicodeLabel) {
    if (!/^\p{L}$/u.test(char)) continue; // digits, hyphens and marks are script-neutral
    seen.add(scriptOf(char));
    if (seen.size > 1) return true;
  }
  return false;
}

function isApexLike(labels: string[]): boolean {
  if (labels.length === 2) return true;
  return (
    labels.length === 3 &&
    labels[2].length === 2 &&
    REGISTRY_LABELS.has(labels[1])
  );
}

function platformApexes(env: EnvLike): string[] {
  return [...platformHosts(env)].map((h) => (h.startsWith("www.") ? h.slice(4) : h));
}

export function normalizeClaimInput(
  raw: string,
  env: EnvLike = process.env,
): NormalizedClaim {
  const fail = (reason: ClaimRefusal): NormalizedClaim => ({ ok: false, reason });

  if (typeof raw !== "string") return fail("invalid_format");
  if (raw.length > MAX_RAW_LENGTH) return fail("too_long");
  let value = raw.trim();
  if (value === "") return fail("empty");

  // Whitespace, control and invisible format characters (zero-width, bidi
  // marks), and percent escapes, which a URL parser would silently decode.
  if (/[\p{C}\p{Z}%]/u.test(value)) return fail("invalid_characters");

  value = value.toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  const cut = value.search(/[/?#\\]/);
  if (cut !== -1) value = value.slice(0, cut);
  if (value.includes("@")) return fail("credentials");

  const colon = value.lastIndexOf(":");
  if (colon !== -1) {
    const port = value.slice(colon + 1);
    if (!/^[0-9]{1,5}$/.test(port)) return fail("invalid_characters");
    value = value.slice(0, colon);
  }
  if (value.endsWith(".")) value = value.slice(0, -1);
  if (value === "") return fail("empty");
  if (value.includes("*")) return fail("wildcard");

  const ascii = domainToASCII(value);
  if (ascii === "") return fail("invalid_format");
  // A malformed punycode label (`xn--a`) survives `domainToASCII` in some
  // inputs; one that does not decode back to the same ASCII is refused.
  const unicode = domainToUnicode(ascii);
  if (domainToASCII(unicode) !== ascii) return fail("invalid_format");

  if (ascii.length > MAX_HOST_LENGTH) return fail("too_long");
  const labels = ascii.split(".");
  if (labels.some((label) => !LABEL_RE.test(label))) return fail("invalid_format");
  if (labels.length < 2) return fail("too_few_labels");

  // An IP literal in any spelling a URL parser would normalize to one. Checked
  // on the INPUT's last label as well as the ASCII form (`0x7f.1`).
  const lastInput = value.slice(value.lastIndexOf(".") + 1);
  if (/^(?:[0-9]+|0x[0-9a-f]*)$/.test(lastInput) || /^[0-9]+$/.test(labels[labels.length - 1])) {
    return fail("ip_address");
  }

  if (ascii === "localhost" || ascii.endsWith(".localhost")) return fail("reserved");
  if (ascii === "vercel.app" || ascii.endsWith(".vercel.app")) return fail("reserved");
  if (isPlatformHost(ascii, env)) return fail("reserved");
  for (const apex of platformApexes(env)) {
    if (ascii === apex || ascii.endsWith(`.${apex}`)) return fail("reserved");
  }
  const allowReserved = (env.DOMAINS_ALLOW_RESERVED_TLDS ?? "") === "1";
  if (!allowReserved && RESERVED_TLDS.has(labels[labels.length - 1])) return fail("reserved");

  for (const label of unicode.split(".")) {
    if (mixedScript(label)) return fail("mixed_script");
  }

  // The pair is offered only when its `www.` row is itself a legal hostname;
  // an apex too long to carry the prefix is held alone.
  const pairable =
    !ascii.startsWith("www.") &&
    isApexLike(labels) &&
    `www.${ascii}`.length <= MAX_HOST_LENGTH;
  const hostnames = pairable ? [ascii, `www.${ascii}`] : [ascii];
  return {
    ok: true,
    claimName: ascii,
    displayName: unicode,
    hostnames,
    pairable,
  };
}
