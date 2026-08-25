/**
 * The pure half of the portal-home greeting — extracted from
 * `src/components/org-portal/greeting.tsx` specifically so the hour-boundary
 * logic is unit-testable without rendering anything (Phase 3's own test
 * plan: "component tests for the greeting/time logic if extracted pure").
 *
 * TIME OF DAY IS THE SERVER'S CLOCK, NOT THE VIEWER'S. Greeting.tsx is a
 * Server Component and reads `new Date()` at render time — a known,
 * accepted tradeoff for Increment 1: a congregation's members are
 * overwhelmingly in one timezone (the congregation's own), so a
 * server-clock greeting is right for the common case and merely "a little
 * off" near a boundary hour for the rare visitor elsewhere. Making this
 * viewer-local would mean a client-rendered greeting (the `<FormattedDate>`
 * hydration-swap pattern) for a purely decorative string — judged not worth
 * the complexity here. Recorded as a UX tradeoff in the Increment 1
 * work-log, not silently absorbed.
 */
export function timeOfDayGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}
