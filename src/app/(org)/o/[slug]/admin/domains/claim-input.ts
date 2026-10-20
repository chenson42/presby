/**
 * claim-input.ts - the client-side hint for the claim form: does what was typed
 * look like a bare domain (an "apex") that pairs with its `www.` twin? When it
 * does, the form asks which of the two should be the primary address.
 *
 * ONLY A HINT, and deliberately a re-statement of the pairing heuristic in
 * `src/lib/domains/hostname-rules.ts` (which is `server-only`, so a client
 * component cannot import it): exactly two labels, or three where the middle one
 * is a well-known registry label under a two-letter country code. The server
 * decides what is actually held; `claim-input.test.ts` pins this function
 * against `normalizeClaimInput().pairable` over a table so the two cannot
 * drift. Wrong in either direction it costs one radio group shown or hidden,
 * never a wrong claim.
 */

const REGISTRY_LABELS = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "or", "ne", "go"]);

export function looksLikeApex(raw: string): boolean {
  let value = raw.trim().toLowerCase();
  if (value === "") return false;
  value = value.replace(/^https?:\/\//, "");
  const cut = value.search(/[/?#\\]/);
  if (cut !== -1) value = value.slice(0, cut);
  const colon = value.lastIndexOf(":");
  if (colon !== -1) value = value.slice(0, colon);
  if (value.endsWith(".")) value = value.slice(0, -1);
  if (value === "" || value.startsWith("www.")) return false;
  const labels = value.split(".");
  if (labels.some((l) => l === "")) return false;
  if (labels.length === 2) return true;
  return labels.length === 3 && labels[2].length === 2 && REGISTRY_LABELS.has(labels[1]);
}
