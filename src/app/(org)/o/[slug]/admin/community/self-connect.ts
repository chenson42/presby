import "server-only";
import { withOrgContext } from "@/lib/authz";
import { orgFeatureEnabledInTx } from "@/lib/org-features";
import { SIGN_IN_CONNECT_TOGGLE } from "@/lib/onboarding/org-invite";

/**
 * Whether this organization lets a signed-in person be connected to their record
 * by an address on file (`org_portal.sign_in_connect`), read the way the Sign-in
 * card reads it (`getSignInCard`: the toggle row alone, category axis off), so
 * the engagement dialog's "could be connected automatically" line and the card
 * can never disagree.
 *
 * `null`, never `false`, when the read failed: the dialog then omits the line
 * rather than state that nothing can happen. One small read per list page, only
 * for an administrator who will see the row buttons; it never throws.
 */
export async function getSelfConnectEnabled(
  viewerPersonId: string,
  organizationId: string,
): Promise<boolean | null> {
  try {
    return await withOrgContext(viewerPersonId, organizationId, (tx) =>
      orgFeatureEnabledInTx(tx, organizationId, SIGN_IN_CONNECT_TOGGLE, false),
    );
  } catch {
    return null;
  }
}
