import { SESSION_BANNER_COPY } from "@/lib/onboarding/sign-in-copy";

/**
 * The Session explainer on the Officers page (Increment 2, DECISION-205 and
 * DECISION-206; reworded by Community Increment 2b, Copy group F): recording one
 * of these offices seats the holder on the Session, which is what lets them
 * approve the roll actions waiting in the queue, once they have connected a
 * sign-in (by signing in with the address on their record, or by accepting an
 * invitation). Server component; the words are `SESSION_BANNER_COPY.officersNote`.
 */
export function SessionNote() {
  return (
    <p className="max-w-prose text-sm text-muted-foreground" data-testid="session-note">
      {SESSION_BANNER_COPY.officersNote}
    </p>
  );
}
