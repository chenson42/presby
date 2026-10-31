import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { platformOrigin } from "@/lib/domains/host";
import { attemptQueuedSend, insertQueueRowInTx } from "@/lib/email/queue";
import { renderEmail, type RenderedEmail } from "@/lib/email/render";
import { getTicketOperatorPool } from "@/lib/tickets-notifications";
import { HELP_CONTACT_EMAIL_COPY as COPY, HELP_CONTACT_INBOX_PATH } from "./copy";

/**
 * The operator notification for a new contact message (CA4, DECISION-301).
 *
 * CONTENT-FREE and constant. This file does not receive the typed name, email,
 * congregation or message, so there is no way for it to put one in a queue row,
 * and the queue row's `to` is always an operator's own ACCOUNT address (template
 * `help_contact_notification` is `account` in the audience registry). The typed
 * address is never mailed by any path (C5).
 *
 * SEQUENCE. The caller has already committed the message and learned from the
 * definer that this one claimed the notification window. Here: one queue row per
 * `getTicketOperatorPool()` operator (the single definition of "holders of
 * FEATURES.ADMIN_TICKETS"), all in one transaction, BEFORE the response; only
 * the provider attempt runs in `after()`. Running the provider call inline for
 * the claiming submission only would let a sender read the claim from latency
 * (AF-4); running the whole step in `after()` would let a cut-off spend the slot
 * with nothing queued. The 5-minute /api/cron/email-queue is the durable backstop
 * for a send that did not happen.
 *
 * NEVER THROWS to the caller's outcome: a failed enqueue loses this window's
 * email (an accepted residual; the dashboard "Contact messages" card is the
 * backstop), and is logged by error class only.
 */

export const HELP_CONTACT_TEMPLATE_KEY = "help_contact_notification";

/** The constant message. Exported for the test that pins it content-free. */
export function buildHelpContactEmail(): RenderedEmail {
  const origin = platformOrigin();
  return renderEmail({
    subject: COPY.subject,
    preheader: COPY.preheader,
    heading: COPY.heading,
    blocks: [
      { kind: "p", text: COPY.paragraph1 },
      { kind: "p", text: COPY.paragraph2 },
    ],
    action: origin ? { label: COPY.button, href: `${origin}${HELP_CONTACT_INBOX_PATH}` } : undefined,
    footnote: COPY.footnote,
  });
}

function errorClass(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** Queue one content-free notification per operator, then try to send them after the response. */
export async function notifyOperatorsOfContactMessage(): Promise<{ queued: number }> {
  try {
    const operators = await getTicketOperatorPool();
    if (operators.length === 0) {
      console.warn(
        "[help-contact] no account holds admin.tickets; the message is stored and nobody was emailed",
      );
      return { queued: 0 };
    }

    const message = buildHelpContactEmail();
    const rows = await db.transaction(async (tx) => {
      const inserted: { id: string }[] = [];
      for (const operator of operators) {
        inserted.push(
          await insertQueueRowInTx(tx, {
            to: operator.email,
            message,
            templateKey: "help_contact_notification",
          }),
        );
      }
      return inserted;
    });

    try {
      for (const row of rows) {
        after(async () => {
          try {
            await attemptQueuedSend(row.id);
          } catch (err) {
            console.error("[help-contact] notification send attempt failed", { errorClass: errorClass(err) });
          }
        });
      }
    } catch (err) {
      // `after()` outside a request scope throws; the rows stay queued for the cron.
      console.error("[help-contact] could not schedule the send", { errorClass: errorClass(err) });
    }
    return { queued: rows.length };
  } catch (err) {
    console.error("[help-contact] notification not queued", { errorClass: errorClass(err) });
    return { queued: 0 };
  }
}
