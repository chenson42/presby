import { toast } from "sonner";
import type { EditableEngagement, Engagement } from "@/lib/membership-standing";
import { changeEngagementAction } from "./actions";
import { CHANGE_ENGAGEMENT_COPY, engagementSuccessMessage } from "./engagement-copy";

/**
 * The one client path every engagement change takes (the Inactive row's
 * "Mark as regular", the Engagement card's Save, the visitor nudge): it calls
 * `changeEngagementAction` and ALWAYS sends `expectedFrom`, the engagement the
 * page rendered, never a value read at click time. That is what lets the server
 * answer "This changed while you were looking" instead of overwriting another
 * administrator's change (Phase 3 acknowledgement, B-1 and "For Batch C" 1).
 *
 * `unchanged` comes back as a refusal (`ok: false`), so it is shown in the
 * refusal style, not as a success. A refusal toast carries the action's own
 * sentence; a thrown error (network) shows the fixed database sentence and says
 * `thrown` so the caller can leave its dialog open for a retry.
 */
export type SubmitEngagementResult =
  | { kind: "saved" }
  | { kind: "refused" }
  | { kind: "thrown" };

export async function submitEngagementChange(args: {
  slug: string;
  personId: string;
  personName: string;
  /** The engagement the page rendered. */
  from: Engagement;
  to: EditableEngagement;
}): Promise<SubmitEngagementResult> {
  try {
    const result = await changeEngagementAction(args.slug, {
      personId: args.personId,
      to: args.to,
      expectedFrom: args.from,
    });
    if (result.ok) {
      toast.success(engagementSuccessMessage(args.personName, args.to));
      return { kind: "saved" };
    }
    toast.error(result.error);
    return { kind: "refused" };
  } catch {
    toast.error(CHANGE_ENGAGEMENT_COPY.db_error);
    return { kind: "thrown" };
  }
}
