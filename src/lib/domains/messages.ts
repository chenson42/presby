import type { ClaimRefusal } from "./hostname-rules";

/**
 * messages.ts - the human copy for domain-claim refusals, PURE and shared by
 * the tenant action and the platform on-behalf action so the two cannot drift.
 * Plain English, no provider vocabulary, no organization named (G30, A12).
 */

const CLAIM_REFUSAL_COPY: Record<ClaimRefusal, string> = {
  empty: "Enter your domain, like yourchurch.org.",
  too_long: "That's too long to be a domain name.",
  invalid_characters:
    "That doesn't look like a domain name. Enter just the name, like yourchurch.org.",
  invalid_format:
    "That doesn't look like a domain name. Enter just the name, like yourchurch.org.",
  credentials: "Enter only the domain name, without a username or an @.",
  wildcard: "Wildcard domains aren't supported. Enter your main domain, like yourchurch.org.",
  ip_address: "Enter a domain name, not an IP address.",
  too_few_labels: "Enter the full domain, including its ending (like .org).",
  reserved: "That name can't be connected here.",
  mixed_script: "That name mixes alphabets within one word, which we can't accept.",
};

export function claimRefusalMessage(reason: ClaimRefusal): string {
  return CLAIM_REFUSAL_COPY[reason];
}
