/**
 * Lib-safe, explicit-timezone date formatting for contexts <FormattedDate>
 * cannot reach — plain strings (error messages, audit descriptions, email
 * bodies) built outside JSX, where there is no mount lifecycle to swap an
 * SSR fallback for a client-local render. Always UTC, always deterministic
 * regardless of which server (or which developer's laptop) runs it — the
 * exact SSR-timezone-mismatch guarantee `no-restricted-syntax` bans
 * `toLocale*()` to protect, just enforced by construction instead of by
 * hydration. TRADEOFF, not a defect: the rendered date is the UTC calendar
 * day, which can read one day off from the viewer's own local day for an
 * instant near midnight UTC. Acceptable for a one-line error toast or log
 * line; NOT a substitute for <FormattedDate> in anything rendered to a
 * page, where the viewer's own local day is the correct answer.
 */
export function formatDateUTC(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
  }).format(date);
}
