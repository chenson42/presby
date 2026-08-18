/**
 * Validates that a callbackUrl is a safe same-origin relative path.
 * Rejects protocol-relative URLs (starting with "//") and any absolute URL.
 * Falls back to /home if the value is absent or invalid.
 */
export function sanitizeCallbackUrl(raw: string | undefined | null): string {
  if (!raw) return "/home";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/home";
}
