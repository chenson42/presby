import { DatedText } from "@/components/shared/dated-text";
import { NO_ORG_INVITATION_COPY } from "@/lib/onboarding/no-organization-copy";
import { AcceptInPlaceForm } from "./accept-in-place-form";
import type { InvitationCardView } from "./view";

/**
 * Used only if a `sign_in` listing row has no name. The listing returns the name
 * for every `sign_in` row to the proven holder, so this is unreachable by
 * construction; the fallback keeps the sentence grammatical rather than printing
 * "as null".
 */
const NAME_FALLBACK = "you";

/** The heading over the cards: one invitation names its congregation, several are counted. */
export function invitationsHeading(cards: readonly InvitationCardView[]): string {
  return cards.length === 1
    ? NO_ORG_INVITATION_COPY.headingOne(cards[0].organizationName)
    : NO_ORG_INVITATION_COPY.headingMany(cards.length);
}

function cardSentence(card: InvitationCardView): string {
  return card.purpose === "sign_in"
    ? NO_ORG_INVITATION_COPY.cardSignIn(card.organizationName, card.personDisplayName?.trim() || NAME_FALLBACK)
    : NO_ORG_INVITATION_COPY.cardDesignation(card.organizationName, card.purpose);
}

/**
 * One card per open invitation, in the listing's order (N1). A Server Component:
 * the only interactive part is the small accept island. The congregation name and
 * the person's name are data, so they wrap (`break-words`) rather than overflow
 * a 360px screen.
 */
export function InvitationCards({
  cards,
  enrolled,
  headingLevel = 2,
}: {
  cards: readonly InvitationCardView[];
  enrolled: boolean;
  headingLevel?: 1 | 2;
}) {
  if (cards.length === 0) return null;
  const Heading = `h${headingLevel}` as "h1" | "h2";
  return (
    <section aria-labelledby="invitations-heading" data-testid="invitation-cards">
      <Heading
        id="invitations-heading"
        className={headingLevel === 1 ? "break-words text-2xl font-semibold" : "break-words text-xl font-semibold"}
      >
        {invitationsHeading(cards)}
      </Heading>
      <ul className="mt-4 space-y-4">
        {cards.map((card) => (
          <li
            key={card.invitationId}
            data-testid="invitation-card"
            className="space-y-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
          >
            <p className="break-words text-sm">{cardSentence(card)}</p>
            <p className="text-sm text-muted-foreground">
              <DatedText dates={[card.expiresAt]} render={(date) => NO_ORG_INVITATION_COPY.expires(date)} />
            </p>
            <AcceptInPlaceForm
              invitationId={card.invitationId}
              secondFactorNeeded={card.secondFactorNeeded}
              enrolled={enrolled}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
