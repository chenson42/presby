/**
 * The two public notices (Copy P1, P2). Plain paragraphs with no heading of their
 * own: the page or the slot's section owns the heading, so they can sit in either.
 *
 * `CareersUnavailableNotice` is the ONE string for "this organization does not
 * publish openings" and "the read failed" in the slot (DECISION-154): the slot
 * cannot tell them apart and must not claim to. `CareersEmptyNotice` is only for
 * a SUCCESSFUL read that returned no postings - "right now", not a history - and
 * adds the profile phone only when the organization has one.
 */

export function CareersUnavailableNotice() {
  return (
    <p data-testid="careers-unavailable" className="text-base">
      Our job openings aren&apos;t available right now. Please check back soon.
    </p>
  );
}

export function CareersEmptyNotice({ contactPhone }: { contactPhone: string | null }) {
  return (
    <p data-testid="careers-empty" className="text-base [overflow-wrap:anywhere]">
      We don&apos;t have any open positions right now. Please check back soon.
      {contactPhone ? ` You can also call us at ${contactPhone}.` : ""}
    </p>
  );
}
