import { renderEmail, type RenderedEmail } from "@/lib/email/render";

/**
 * The reimbursement notices - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * Copy C10, EC22, P3-1, P3-11 and DECISION-271. PURE: no database, no
 * `server-only`; `renderEmail` is imported from `render.ts` directly, never the
 * `@/lib/email` barrel (which pulls in the server-only queue).
 *
 * `email_queue` is a platform table with full `presby_app` DML, no RLS and
 * indefinite retention. A reimbursement's CONTENT therefore never enters it: a
 * notice says that a request needs something and where to open it, and the
 * builder takes NOTHING ELSE to say it with. Its inputs are a closed `spec`
 * (which notice) and the link; there is no parameter through which an amount,
 * a name, a purpose, a group or a date could arrive, so the guarantee is the
 * function signature and `notices.test.ts` asserts it on the FULL rendered
 * subject, html and text (not on a fragment).
 *
 * THE LINK is a bare path, `<platform origin>/o/<slug>/reimbursements/<id>`
 * (`/o/<slug>/admin/reimbursements/<id>` for the people who pay), never
 * `/launch?next=...`: the proxy sends a signed-out visitor to
 * `/signin?callbackUrl=<pathname>` (path only) and `/launch` itself drops `next`,
 * so a bare path is the shape that survives sign-in and the two-factor hop
 * (P3-1, F321). The origin is `platformOrigin()` and never the request host.
 *
 * ADDRESS CLASS. All four template keys are `person:role` in the audience
 * registry (`email-audience.ts`): a requester is often staff with only a work
 * address, and approver, treasurer and requester notices use one purpose so a
 * recipient is reached at the same address in all of them (P3-11).
 */

export const NOTICE_TEMPLATE_KEYS = {
  needsApproval: "reimbursement.notice.needs_approval",
  needsTreasurer: "reimbursement.notice.needs_treasurer",
  readyToPay: "reimbursement.notice.ready_to_pay",
  requesterUpdate: "reimbursement.notice.requester_update",
} as const;

export type NoticeTemplateKey = (typeof NOTICE_TEMPLATE_KEYS)[keyof typeof NOTICE_TEMPLATE_KEYS];

/** The five things the requester can be told. `paid` and `closed` are sent by Batch 4's payment and void paths. */
export const REQUESTER_UPDATE_VARIANTS = ["approved", "sent_back", "not_approved", "paid", "closed"] as const;
export type RequesterUpdateVariant = (typeof REQUESTER_UPDATE_VARIANTS)[number];

export type NoticeSpec =
  /** The eligible approvers of the group, when a request is sent. */
  | { kind: "needs_approval" }
  /** Every effective `pay` holder, when no one in the group can approve. */
  | { kind: "needs_treasurer" }
  /** Every effective `pay` holder except the approver, once approved. */
  | { kind: "ready_to_pay" }
  /** The creator. */
  | { kind: "requester_update"; variant: RequesterUpdateVariant };

export function noticeTemplateKey(spec: NoticeSpec): NoticeTemplateKey {
  switch (spec.kind) {
    case "needs_approval":
      return NOTICE_TEMPLATE_KEYS.needsApproval;
    case "needs_treasurer":
      return NOTICE_TEMPLATE_KEYS.needsTreasurer;
    case "ready_to_pay":
      return NOTICE_TEMPLATE_KEYS.readyToPay;
    case "requester_update":
      return NOTICE_TEMPLATE_KEYS.requesterUpdate;
  }
}

export type NoticeSurface = "member" | "treasury";

/** Where the link goes: the people who pay open the treasury page; an approver and the requester the member page. */
export function noticeSurface(spec: NoticeSpec): NoticeSurface {
  return spec.kind === "needs_treasurer" || spec.kind === "ready_to_pay" ? "treasury" : "member";
}

const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The absolute link in a notice. A slug or id that is not path-safe throws: both
 * come from the database, and a link must never be bent by what a row held.
 */
export function noticeLink(origin: string, slug: string, requestId: string, surface: NoticeSurface): string {
  if (!SLUG.test(slug)) throw new Error("noticeLink: slug is not path-safe");
  if (!UUID.test(requestId)) throw new Error("noticeLink: request id is not a uuid");
  const base = origin.replace(/\/+$/, "");
  return surface === "treasury"
    ? `${base}/o/${slug}/admin/reimbursements/${requestId}`
    : `${base}/o/${slug}/reimbursements/${requestId}`;
}

const FOOTNOTE = "Sign in to see the details. This message doesn't include any.";
const BUTTON = "Open the request";

const REQUESTER_UPDATE: Record<RequesterUpdateVariant, { heading: string; body: string }> = {
  approved: { heading: "Your reimbursement request was approved", body: "It is now waiting for payment." },
  sent_back: {
    heading: "Your reimbursement request was sent back",
    body: "It needs a change before it can go on. Open it to see why.",
  },
  not_approved: { heading: "Your reimbursement request wasn't approved", body: "Open it to see why." },
  paid: { heading: "Your reimbursement request was paid", body: "A payment has been recorded for it." },
  closed: { heading: "Your reimbursement request was closed", body: "Open it to see what happened." },
};

function wording(spec: NoticeSpec): { heading: string; body: string } {
  switch (spec.kind) {
    case "needs_approval":
      return {
        heading: "A reimbursement request needs your approval",
        body: "A reimbursement request is waiting, and you are one of the people who can approve it.",
      };
    case "needs_treasurer":
      return {
        heading: "A reimbursement request needs a treasurer's approval",
        body: "No one in the group it is charged to is able to approve it, so it is waiting for someone who can.",
      };
    case "ready_to_pay":
      return {
        heading: "A reimbursement request is ready to pay",
        body: "An approved reimbursement request is waiting for payment.",
      };
    case "requester_update":
      return REQUESTER_UPDATE[spec.variant];
  }
}

export interface BuiltNotice {
  templateKey: NoticeTemplateKey;
  /** The laid-out message: pass it to `insertQueueRowInTx({ message })`. */
  message: RenderedEmail;
}

/** Subject = heading (Copy C10). Nothing but `spec` and `link` goes in. */
export function buildNotice(spec: NoticeSpec, link: string): BuiltNotice {
  const { heading, body } = wording(spec);
  const message = renderEmail({
    subject: heading,
    heading,
    blocks: [{ kind: "p", text: body }],
    action: { label: BUTTON, href: link },
    footnote: FOOTNOTE,
  });
  return { templateKey: noticeTemplateKey(spec), message };
}
