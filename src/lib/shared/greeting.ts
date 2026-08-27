/**
 * MOVED HERE, UNMODIFIED, FROM `src/lib/org-portal/greeting.ts` — commit 1 of
 * docs/work-log/2026-08-27-platform-home-and-portal.md (Phase 3,
 * DECISION-125). `/admin`'s previously bare `<h1>Welcome, {name}.</h1>`
 * adopts the same greeting-band component this logic backs, so the pure
 * hour-boundary logic now lives where both axes can import it — the same
 * "two components would drift" reasoning `DestinationCard`'s own header
 * comment already gives.
 *
 * TIME OF DAY IS THE SERVER'S CLOCK, NOT THE VIEWER'S. `GreetingBand.tsx` is
 * a Server Component and reads `new Date()` at render time — a known,
 * accepted tradeoff: a congregation's members are overwhelmingly in one
 * timezone (the congregation's own), so a server-clock greeting is right
 * for the common case and merely "a little off" near a boundary hour for
 * the rare visitor elsewhere. Making this viewer-local would mean a
 * client-rendered greeting (the `<FormattedDate>` hydration-swap pattern)
 * for a purely decorative string — judged not worth the complexity.
 */
export function timeOfDayGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}
