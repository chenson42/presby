/**
 * The Session explainer on the Officers page (Increment 2, DECISION-205 and
 * DECISION-206): recording one of these offices seats the holder on the
 * Session, which is what lets them approve the roll actions waiting in the
 * queue. Honest about the account requirement: until sign-in invitations ship
 * (Increment 2b), a seat with no PresbyPortal account cannot approve. Server
 * component, static copy.
 */
export function SessionNote() {
  return (
    <p
      className="max-w-prose text-sm text-muted-foreground"
      data-testid="session-note"
    >
      Members of the Session decide who is received onto the roll. Recording a
      ruling elder, installed pastor, co-pastor or associate pastor here seats
      them on the Session. They can approve only once they have a PresbyPortal
      account.
    </p>
  );
}
