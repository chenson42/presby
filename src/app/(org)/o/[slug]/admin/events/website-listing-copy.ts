/**
 * The editor-side strings for putting an event on the public website - ONE
 * place, so the new-event form, the edit form, the list and the detail page
 * can never disagree (docs/work-log/2026-10-25-public-events-calendar.md,
 * Phase 3 "Copy" E1-E9).
 *
 * TRUTH BOUNDARIES, because these strings were wrong once (the old checkbox
 * said "Visible on the public calendar" and controlled nothing):
 *   - "marked for the website" says what the ROW says (`website_listed`), never
 *     that the event is live: whether it appears also depends on the
 *     congregation's public events calendar being turned on and on a website page
 *     carrying the calendar, neither of which an event row can know.
 *   - "Open to everyone" is `is_public`. It is the veto: a members-only event
 *     cannot go on the website (database CHECK plus a read-time filter).
 *   - Free text goes out verbatim and search engines and web archives keep
 *     copies; the hint says so rather than implying a take-down recalls them.
 * Pure: no `server-only`, safe in a client component and a unit test.
 */

/** E1 */
export const WEBSITE_LABEL = "Show on our website's public calendar";

/** E2 */
export const WEBSITE_HINT =
  "Anyone on the internet can read this event's title, description, location and event type. Search engines and web archives may keep copies, so taking the event off later does not remove copies already made. Leave out private details. It appears once your congregation's public events calendar is turned on.";

/** E3 (the website box is disabled while "Open to everyone" is unchecked) */
export const WEBSITE_HINT_MEMBERS_ONLY = "Only events open to everyone can be shown on the website.";

/** E4 */
export const OPEN_TO_EVERYONE_LABEL = "Open to everyone, not only members";

/** E4 hint */
export function openToEveryoneHint(orgName: string): string {
  return `If unchecked, the event shows only on the member calendar, for members of ${orgName} who have calendar access. It also stays out of Copy month and cannot be shown on the website.`;
}

/** E9 (edit form, a series occurrence only) */
export const WEBSITE_SERIES_NOTE =
  "This changes this event only. To change this event and the ones after it, use Website listing on the event's page.";

/** E5/E6 visibility values */
export function visibilityLabel(isPublic: boolean): string {
  return isPublic ? "Open to everyone" : "Members only";
}

/** E5 badge */
export const FOR_WEBSITE_BADGE = "For website";

/** E6 detail-line fragment */
export const MARKED_FOR_WEBSITE = "Marked for the website";

/** E6 muted line, shown when the event is marked */
export const MARKED_FOR_WEBSITE_NOTE =
  "It appears on your public website once your congregation's public events calendar is turned on and your website has a calendar page.";

/** E8, extend-series form, only when `inheritsOnExtend` */
export function extendWebsiteLine(additionalCount: number | null): string {
  if (additionalCount === null) {
    return "New events will be marked for the website, like the latest one in this series.";
  }
  return `${additionalCount} new ${additionalCount === 1 ? "event" : "events"} will be marked for the website, like the latest one in this series.`;
}
