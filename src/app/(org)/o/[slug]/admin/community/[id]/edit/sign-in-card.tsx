"use client";

import { DatedText } from "@/components/shared/dated-text";
import {
  CONNECT_OUTLOOK_COPY,
  SIGN_IN_CARD_COPY,
  SIGN_IN_CARD_HEADING,
  blockedCardLine,
} from "@/lib/onboarding/sign-in-copy";
import type { ConnectOutlook, SignInCardState } from "@/lib/onboarding/sign-in-types";
import { CancelSignInDialog } from "./cancel-sign-in-dialog";
import { SendSignInDialog } from "./send-sign-in-dialog";

/**
 * "Sign in to PresbyPortal": the card on the Community edit page
 * (`id="sign-in"`, the target of every marker). A client component only because
 * its three dialogs hold state; the words come from `sign-in-copy.ts`, picked by
 * `card.state` and `card.outlook`, never retyped here. `card` is `null` when the
 * reader failed: the card says so in its own place and the page does not fail.
 *
 * The state of the world, once: `signs_in` states who and how it was connected
 * (never from `users`); `pending` and `expired` are the open invitation; `none`
 * and `revoked` are "invite them"; `blocked` is terminal and offers no button.
 * The connect line (`card.outlook`) is a hedged claim about what signing in will
 * do and is not shown while an invitation is open or blocked (the card's own
 * lines say what applies) or once connected.
 */
export function SignInCard({
  slug,
  personId,
  personName,
  congregation,
  card,
}: {
  slug: string;
  personId: string;
  personName: string;
  congregation: string;
  card: SignInCardState | null;
}) {
  return (
    <section
      id="sign-in"
      aria-labelledby="sign-in-heading"
      data-testid="sign-in-card"
      className="scroll-mt-20 space-y-4 rounded-xl border bg-card p-6 shadow-sm"
    >
      <h2 id="sign-in-heading" className="text-lg font-semibold">
        {SIGN_IN_CARD_HEADING}
      </h2>
      {card === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {SIGN_IN_CARD_COPY.loadFailed}
        </p>
      ) : (
        <CardBody slug={slug} personId={personId} personName={personName} congregation={congregation} card={card} />
      )}
    </section>
  );
}

function Line({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <p className={muted ? "break-words text-sm text-muted-foreground" : "break-words text-sm"}>{children}</p>;
}

function OutlookLine({ outlook, name, address, congregation }: { outlook: ConnectOutlook; name: string; address: string | null; congregation: string }) {
  switch (outlook) {
    case "by_sign_in":
      return address ? <Line muted>{CONNECT_OUTLOOK_COPY.by_sign_in(name, address)}</Line> : null;
    case "by_sign_in_second_factor":
      return address ? <Line muted>{CONNECT_OUTLOOK_COPY.by_sign_in_second_factor(name, address)}</Line> : null;
    case "visitor":
      return <Line muted>{CONNECT_OUTLOOK_COPY.visitor(name)}</Line>;
    case "shared_address":
      return <Line muted>{CONNECT_OUTLOOK_COPY.shared_address(name)}</Line>;
    case "turned_off":
      return <Line muted>{CONNECT_OUTLOOK_COPY.turned_off(congregation)}</Line>;
    case "connected":
    case "none":
      return null;
  }
}

function ConnectedLines({ card, name }: { card: SignInCardState; name: string }) {
  const copy = SIGN_IN_CARD_COPY;
  const date = card.connectedOn;
  return (
    <>
      <Line>
        {card.connectedVia === "sign_in" && date ? (
          <DatedText dates={[date]} render={(d) => copy.connectedThroughSignIn(d)} />
        ) : card.connectedVia === "invitation" && date ? (
          <DatedText dates={[date]} render={(d) => copy.connectedThroughInvitation(d)} />
        ) : (
          copy.connectedUnknown(name)
        )}
      </Line>
      <Line muted>{copy.connectedSupport}</Line>
    </>
  );
}

function CardBody({
  slug,
  personId,
  personName,
  congregation,
  card,
}: {
  slug: string;
  personId: string;
  personName: string;
  congregation: string;
  card: SignInCardState;
}) {
  const copy = SIGN_IN_CARD_COPY;
  const name = personName;
  const send = (mode: "send" | "resend", label: string, address: string, disabled = false) => (
    <SendSignInDialog
      mode={mode}
      slug={slug}
      personId={personId}
      personName={name}
      address={address}
      isVisitor={card.isVisitor}
      triggerLabel={label}
      disabled={disabled}
      triggerVariant={mode === "send" ? "default" : "outline"}
    />
  );
  const cancel = (
    <CancelSignInDialog slug={slug} personId={personId} personName={name} triggerLabel={copy.buttons.cancel} />
  );
  const buttons = (children: React.ReactNode) => (
    <div className="flex flex-col gap-2 sm:flex-row">{children}</div>
  );

  switch (card.state) {
    case "signs_in":
      return <ConnectedLines card={card} name={name} />;

    case "blocked":
      return <Line>{blockedCardLine(card.blockedOutcome ?? "needs_support", name, congregation)}</Line>;

    case "pending": {
      const address = card.address;
      const invited = card.invitedAddress ?? address;
      const delivery = card.delivery;
      const bounced = delivery === "bounced" || delivery === "failed";
      const deliveryWord =
        delivery === "queued" || delivery === "sent" || delivery === "delivered" ? copy.delivery[delivery] : null;
      return (
        <>
          {address === null || invited === null ? (
            <>
              <Line>{copy.noAddress(name)}</Line>
              {buttons(cancel)}
            </>
          ) : card.addressCurrent === false ? (
            <>
              <Line>{copy.addressChanged(address)}</Line>
              {card.chainCapReached ? <Line muted>{copy.chainCap(name)}</Line> : null}
              {buttons(
                <>
                  {!card.chainCapReached && send("resend", copy.buttons.sendAgain, address, card.cooldownMinutes > 0)}
                  {cancel}
                </>,
              )}
              {card.cooldownMinutes > 0 && <Line muted>{copy.cooldown(card.cooldownMinutes)}</Line>}
            </>
          ) : bounced ? (
            <>
              <Line>{copy.bounced(invited)}</Line>
              {card.chainCapReached ? <Line muted>{copy.chainCap(name)}</Line> : null}
              {buttons(
                <>
                  {!card.chainCapReached && send("resend", copy.buttons.sendAgain, address, card.cooldownMinutes > 0)}
                  {cancel}
                </>,
              )}
              {card.cooldownMinutes > 0 && <Line muted>{copy.cooldown(card.cooldownMinutes)}</Line>}
            </>
          ) : (
            <>
              <Line>
                <DatedText
                  dates={[card.sentAt ?? "", card.expiresAt ?? ""]}
                  render={(sent, expires) => copy.pending(invited, sent, expires)}
                />
                {deliveryWord ? <span className="ml-1 font-medium">{deliveryWord}</span> : null}
              </Line>
              {card.chainCapReached ? (
                <Line muted>{copy.chainCap(name)}</Line>
              ) : card.cooldownMinutes > 0 ? (
                <Line muted>{copy.cooldown(card.cooldownMinutes)}</Line>
              ) : (
                <Line muted>{copy.sendAgainHint}</Line>
              )}
              {buttons(
                <>
                  {!card.chainCapReached && send("resend", copy.buttons.sendAgain, address, card.cooldownMinutes > 0)}
                  {cancel}
                </>,
              )}
            </>
          )}
          <OutlookPending name={name} />
        </>
      );
    }

    case "expired": {
      const address = card.address;
      const invited = card.invitedAddress ?? address;
      if (address === null || invited === null) {
        return (
          <>
            <Line>{copy.noAddress(name)}</Line>
            {buttons(cancel)}
          </>
        );
      }
      return (
        <>
          {card.addressCurrent === false || !card.expiresAt ? (
            <Line>{copy.addressChanged(address)}</Line>
          ) : (
            <Line>
              <DatedText dates={[card.expiresAt]} render={(date) => copy.expired(invited, date)} />
            </Line>
          )}
          {card.chainCapReached ? <Line muted>{copy.chainCap(name)}</Line> : null}
          {buttons(
            <>
              {!card.chainCapReached && send("resend", copy.buttons.sendNew, address, card.cooldownMinutes > 0)}
              {cancel}
            </>,
          )}
          {card.cooldownMinutes > 0 && <Line muted>{copy.cooldown(card.cooldownMinutes)}</Line>}
          <OutlookLine outlook={card.outlook} name={name} address={address} congregation={congregation} />
        </>
      );
    }

    case "none":
    case "revoked": {
      const address = card.address;
      if (address === null) return <Line>{copy.noAddress(name)}</Line>;
      return (
        <>
          <Line>{copy.none(name, address)}</Line>
          <OutlookLine outlook={card.outlook} name={name} address={address} congregation={congregation} />
          {buttons(send("send", copy.buttons.send, address))}
        </>
      );
    }
  }
}

/** The line shown while an invitation is open: signing in does not connect by itself. */
function OutlookPending({ name }: { name: string }) {
  return <Line muted>{CONNECT_OUTLOOK_COPY.pendingInvitation(name)}</Line>;
}
