/**
 * The one environment variable help pages read: the privacy policy's contact address.
 *
 * Why here and not in content.ts: this file is pure (no fs, no server-only, no imports), so
 * the parsing is unit-testable without mocking the loader, and `process.env` is read in exactly
 * one place that H19 and the proxy-imports check already walk. The value is read at BUILD
 * only: every help route is `dynamic = "error"`, so the address is baked into the static HTML
 * and never reaches a request. The address is deliberately not a committed value (the
 * repository is public; `check:secrets` flags a real address in a tracked file) and not a
 * `NEXT_PUBLIC_` variable (nothing client-side needs it).
 */
export const PRIVACY_CONTACT_ENV = "HELP_PRIVACY_CONTACT_EMAIL";

// One plain address: no display name, no quotes, no whitespace and none of the characters that
// could close a markdown link (`]`, `)`) or open an angle bracket. The value is inserted into
// markdown as a link destination and as link text, so this shape is what makes that safe.
const ADDRESS_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/**
 * The configured privacy contact address, or null when the variable is unset or blank.
 * A value that is set but is not one plain address THROWS: a build that quietly dropped the
 * operator's address would publish a privacy policy with the wrong contact, and a failed
 * build is the loud, early signal.
 */
export function readPrivacyContactEmail(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const raw = env[PRIVACY_CONTACT_ENV]?.trim();
  if (!raw) return null;
  if (!ADDRESS_RE.test(raw)) {
    throw new Error(`${PRIVACY_CONTACT_ENV} is set but is not a single email address.`);
  }
  return raw;
}
