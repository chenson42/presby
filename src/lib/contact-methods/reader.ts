import "server-only";
import { sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { EMAIL_PURPOSES } from "./email-routing";
import type { EmailPurpose, EmailSubtype } from "./types";

/**
 * The TypeScript door to `presby_person_email()` (drizzle/0064, ER11): which
 * address a person's mail uses for a purpose. THE ONLY TypeScript file that
 * names the function (`scan.test.ts` holds that line), so every caller has to
 * come through here and through the purpose vocabulary.
 *
 * The SQL function is SECURITY INVOKER: it adds no authority and does no
 * scoping, so on the tenant connection it sees what RLS shows (a person with no
 * membership at the current organization returns nothing). It is the credential
 * authority: Community Increment 2b's issue definer calls it in SQL, and a
 * sign-in invitation's address is never trusted from TypeScript. This wrapper
 * serves senders that hold an RLS-scoped transaction. In this pipeline nothing
 * in the app calls it yet; tests and the matrix pin it equal to `chooseEmail()`.
 *
 * `credential` returns the main address even when it is `do_not_contact`; the
 * caller must acknowledge that (`doNotContact` is returned, not hidden).
 */
export interface PersonEmail {
  contactMethodId: string;
  address: string;
  subtype: EmailSubtype | null;
  doNotContact: boolean;
}

export async function getPersonEmail(
  tx: OrgTx,
  personId: string,
  purpose: EmailPurpose,
): Promise<PersonEmail | null> {
  // An unknown purpose is an error here as well as in SQL, never a fallback (R35).
  if (!(EMAIL_PURPOSES as readonly string[]).includes(purpose)) {
    throw new Error(`getPersonEmail: unknown purpose ${String(purpose)}`);
  }
  const result = await tx.execute(sql`
    select contact_method_id, address, subtype, do_not_contact
      from presby_person_email(${personId}::uuid, ${purpose})
  `);
  const row = (
    result as unknown as {
      rows?: Array<{
        contact_method_id: string;
        address: string;
        subtype: string | null;
        do_not_contact: boolean;
      }>;
    }
  ).rows?.[0];
  if (!row) return null;
  return {
    contactMethodId: row.contact_method_id,
    address: row.address,
    subtype: row.subtype as EmailSubtype | null,
    doNotContact: row.do_not_contact,
  };
}
