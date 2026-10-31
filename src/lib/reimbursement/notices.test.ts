/**
 * The four reimbursement notices (docs/work-log/2026-10-25-treasury-inc1.md,
 * Phase 3 Copy C10, EC22, T4): the full RENDERED subject, html and text, not a
 * fragment. `email_queue` is a platform table with no RLS and indefinite
 * retention, so a notice says that a request exists and where to open it and
 * nothing else: no amount, no name, no purpose, no group, no date.
 */
import { describe, expect, it } from "vitest";
import { escapeHtml } from "@/lib/email/escape-html";
import {
  NOTICE_TEMPLATE_KEYS,
  buildNotice,
  noticeLink,
  noticeSurface,
  noticeTemplateKey,
  type NoticeSpec,
  type RequesterUpdateVariant,
} from "./notices";

const REQ = "3b9c5a52-6f0e-4d2b-9a7c-1c2d3e4f5a6b";
const ORIGIN = "https://app.example.invalid";
const SLUG = "alder-creek";
const LINK = `${ORIGIN}/o/${SLUG}/reimbursements/${REQ}`;
const FOOTNOTE = "Sign in to see the details. This message doesn't include any.";

const VARIANTS: readonly RequesterUpdateVariant[] = ["approved", "sent_back", "not_approved", "paid", "closed"];
const SPECS: readonly NoticeSpec[] = [
  { kind: "needs_approval" },
  { kind: "needs_treasurer" },
  { kind: "ready_to_pay" },
  ...VARIANTS.map((variant) => ({ kind: "requester_update", variant }) as const),
];

describe("template keys", () => {
  it("are the four Copy keys, and every spec resolves to one of them", () => {
    expect(NOTICE_TEMPLATE_KEYS).toEqual({
      needsApproval: "reimbursement.notice.needs_approval",
      needsTreasurer: "reimbursement.notice.needs_treasurer",
      readyToPay: "reimbursement.notice.ready_to_pay",
      requesterUpdate: "reimbursement.notice.requester_update",
    });
    const keys = new Set(Object.values(NOTICE_TEMPLATE_KEYS));
    for (const spec of SPECS) expect(keys.has(noticeTemplateKey(spec))).toBe(true);
  });
});

describe("Copy C10: subject = heading, body, button, footnote", () => {
  const cases: Array<[NoticeSpec, string, string]> = [
    [{ kind: "needs_approval" }, "A reimbursement request needs your approval", "A reimbursement request is waiting, and you are one of the people who can approve it."],
    [{ kind: "needs_treasurer" }, "A reimbursement request needs a treasurer's approval", "No one in the group it is charged to is able to approve it, so it is waiting for someone who can."],
    [{ kind: "ready_to_pay" }, "A reimbursement request is ready to pay", "An approved reimbursement request is waiting for payment."],
    [{ kind: "requester_update", variant: "approved" }, "Your reimbursement request was approved", "It is now waiting for payment."],
    [{ kind: "requester_update", variant: "sent_back" }, "Your reimbursement request was sent back", "It needs a change before it can go on. Open it to see why."],
    [{ kind: "requester_update", variant: "not_approved" }, "Your reimbursement request wasn't approved", "Open it to see why."],
    [{ kind: "requester_update", variant: "paid" }, "Your reimbursement request was paid", "A payment has been recorded for it."],
    [{ kind: "requester_update", variant: "closed" }, "Your reimbursement request was closed", "Open it to see what happened."],
  ];

  it.each(cases)("%j", (spec, heading, body) => {
    const { message } = buildNotice(spec, LINK);
    expect(message.subject).toBe(heading);
    expect(message.text).toContain(body);
    expect(message.html).toContain(escapeHtml(body));
    for (const [part, escape] of [[message.html, escapeHtml], [message.text, (s: string) => s]] as const) {
      expect(part).toContain("Open the request");
      expect(part).toContain(escape(FOOTNOTE));
    }
    expect(message.html).toContain(`<h1`);
    expect(message.html).toContain(escapeHtml(heading));
    expect(message.text.startsWith(heading)).toBe(true);
  });

  it("prints the link unchanged as the href, as the printed link and as its own line of text", () => {
    const { message } = buildNotice({ kind: "needs_approval" }, LINK);
    expect(message.html).toContain(`href="${LINK}"`);
    expect(message.html).toContain(`>${LINK}</a>`);
    expect(message.text).toContain(`\n${LINK}\n`);
  });
});

describe("EC22 / T4: a notice carries nothing about the request but where to open it", () => {
  const stripLink = (text: string) => text.split(LINK).join("");

  it.each(SPECS.map((s) => [JSON.stringify(s), s] as const))("%s: no dollar sign, decimal or thousands number anywhere in subject, html or text", (_n, spec) => {
    const { message } = buildNotice(spec, LINK);
    for (const part of [message.subject, message.html, message.text]) {
      expect(part).not.toContain("$");
      expect(part).not.toMatch(/\d+\.\d{2}/);
      expect(part).not.toMatch(/\d{1,3}(,\d{3})+/);
    }
  });

  it.each(SPECS.map((s) => [JSON.stringify(s), s] as const))("%s: the plain text holds no digit outside the link", (_n, spec) => {
    const { message } = buildNotice(spec, LINK);
    expect(stripLink(message.text)).not.toMatch(/\d/);
    expect(message.subject).not.toMatch(/\d/);
  });

  it("the message is a pure function of the spec and the link: nothing else can reach it", () => {
    for (const spec of SPECS) {
      const a = buildNotice(spec, `${ORIGIN}/o/one/reimbursements/${REQ}`).message;
      const b = buildNotice(spec, `${ORIGIN}/o/two/reimbursements/${REQ}`).message;
      expect(a.subject).toBe(b.subject);
      expect(a.html.split("/o/one/").join("/o/two/")).toBe(b.html);
      expect(a.text.split("/o/one/").join("/o/two/")).toBe(b.text);
    }
  });

  it("the NoticeSpec type admits no free text: the builder takes a spec and a link and no other input", () => {
    expect(buildNotice.length).toBe(2);
  });
});

describe("the link (P3-1: a bare path survives sign-in and the two-factor hop)", () => {
  it("is the platform origin plus /o/<slug>/reimbursements/<id> for the member surface", () => {
    expect(noticeLink(ORIGIN, SLUG, REQ, "member")).toBe(LINK);
  });

  it("is /o/<slug>/admin/reimbursements/<id> for the treasury surface", () => {
    expect(noticeLink(ORIGIN, SLUG, REQ, "treasury")).toBe(`${ORIGIN}/o/${SLUG}/admin/reimbursements/${REQ}`);
  });

  it("never goes through /launch and carries no query string", () => {
    for (const surface of ["member", "treasury"] as const) {
      const link = noticeLink(ORIGIN, SLUG, REQ, surface);
      expect(link).not.toContain("/launch");
      expect(link).not.toContain("?");
    }
  });

  it("refuses a slug or id that is not path-safe, so the link cannot be bent by what the database returned", () => {
    expect(() => noticeLink(ORIGIN, "a/../b", REQ, "member")).toThrow();
    expect(() => noticeLink(ORIGIN, SLUG, "not-a-uuid", "member")).toThrow();
    expect(() => noticeLink(ORIGIN, "Has Space", REQ, "member")).toThrow();
  });

  it("approvers and the requester go to the member route; pay holders to the treasury route", () => {
    expect(noticeSurface({ kind: "needs_approval" })).toBe("member");
    expect(noticeSurface({ kind: "requester_update", variant: "approved" })).toBe("member");
    expect(noticeSurface({ kind: "needs_treasurer" })).toBe("treasury");
    expect(noticeSurface({ kind: "ready_to_pay" })).toBe("treasury");
  });
});
