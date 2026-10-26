import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ACCOUNT_INVITATION_PURPOSES_ALLOWED,
  type AccountInvitationPurpose,
} from "@/lib/db/domain/invitations";
import { UUID_RE } from "./input";

/**
 * The open invitations addressed to the signed-in account (Community Increment
 * 2b, R45), for `/no-organization` to list and accept IN PLACE, without the
 * emailed link.
 *
 * CONNECTION: `db` (presby_app) ONLY, like `accept.ts`. `presby_app` holds no
 * table privilege on `account_invitations`; its only way in is EXECUTE on
 * `presby_list_invitations_for_account(user)`, a SECURITY DEFINER function that
 * returns rows only for an ACTIVE account whose address is PROVEN
 * (`users.email_verified`) and equals the invited address. An unproven or
 * inactive account therefore sees an empty list, which is the same shape as an
 * account with nothing waiting: the listing is not an oracle for who has been
 * invited.
 *
 * THE SHAPE IS CLOSED. The function returns the invitation's id, the
 * congregation's name, the purpose, the expiry and, for `sign_in` only, the
 * person's display name (the G5 rule holds by construction: the session matches,
 * the address is proven). It never returns a token hash, the inviter, the
 * address or a person id; `in-place.test.ts` and a `pg_proc` check pin that.
 *
 * `userId` comes ONLY from `auth()` in the caller (E-30). This function throws
 * on a database error: the page turns that into the N5 line ("We couldn't check
 * for invitations just now.") rather than a dead page or a silent empty list.
 *
 * A listed `sign_in` row whose address has since left the person's record is
 * still shown (the listing reads the invitation, not the record); accepting it
 * answers `dead` (R27) and the card shows N4. That is the design's accepted
 * shape (A2 finding 2), not a filter this module can apply: the listing returns
 * no person id or address to filter by.
 */

export interface InPlaceInvitation {
  invitationId: string;
  organizationName: string;
  purpose: AccountInvitationPurpose;
  expiresAt: Date;
  /** `sign_in` only: the person the sign-in will be connected to, in words. */
  personDisplayName: string | null;
}

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

const PURPOSES: readonly string[] = ACCOUNT_INVITATION_PURPOSES_ALLOWED;

export async function listInvitationsForAccount(userId: string): Promise<InPlaceInvitation[]> {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) return [];
  const rows = rowsOf(
    await db.execute(sql`select * from presby_list_invitations_for_account(${userId}::uuid)`),
  );
  const out: InPlaceInvitation[] = [];
  for (const row of rows) {
    // The column is CHECK-closed; an unknown purpose cannot be rendered, so it
    // is left out rather than shown as a card the page cannot describe.
    if (!PURPOSES.includes(String(row.purpose))) continue;
    out.push({
      invitationId: String(row.invitation_id),
      organizationName: String(row.organization_name),
      purpose: row.purpose as AccountInvitationPurpose,
      expiresAt: new Date(row.expires_at as string | Date),
      personDisplayName:
        typeof row.person_display_name === "string" && row.person_display_name.trim()
          ? row.person_display_name
          : null,
    });
  }
  return out;
}
