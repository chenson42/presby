/**
 * Presenters (E5, E7, E23): a failed read is its own state and never reaches
 * "Nothing waiting."; plurals are right; the copy is exactly the Phase 3 Copy
 * table (group D).
 */
import { describe, expect, it } from "vitest";
import {
  presentAccounts,
  presentDomains,
  presentEmail,
  presentContactMessages,
  presentFeedback,
  presentGiving,
  presentOrganizations,
  presentSites,
  presentTickets,
  presentTwoFactor,
} from "./present";

const FAIL = { kind: "error" } as const;
const ERROR_STATE = { kind: "error", retryHref: "/admin" };

describe("a failed read is never an all-clear (E5)", () => {
  it.each([
    ["tickets", presentTickets],
    ["feedback", presentFeedback],
    ["contact messages", presentContactMessages],
    ["email", presentEmail],
    ["giving", presentGiving],
    ["domains", presentDomains],
    ["sites", presentSites],
    ["two-factor", presentTwoFactor],
    ["accounts", presentAccounts],
    ["organizations", presentOrganizations],
  ] as const)("%s: error in, error state out", (_name, present) => {
    const state = (present as (r: typeof FAIL) => unknown)(FAIL);
    expect(state).toEqual(ERROR_STATE);
    expect(JSON.stringify(state)).not.toMatch(/Nothing waiting|"0|No organizations/);
  });
});

describe("tickets", () => {
  it("pluralises, leads with the new count, and links to the new filter", () => {
    expect(
      presentTickets({ kind: "ok", newCount: 1, unassignedOpen: 0, oldestNewSeconds: 120 }),
    ).toEqual({
      kind: "ok",
      tone: "attention",
      headline: "1 new ticket",
      lines: ["Oldest new ticket has waited 2 min"],
      href: "/admin/tickets?status=new",
    });
    const two = presentTickets({ kind: "ok", newCount: 2, unassignedOpen: 3, oldestNewSeconds: 7200 });
    expect(two).toMatchObject({ headline: "2 new tickets", lines: ["Oldest new ticket has waited 2 h", "3 open and not assigned"] });
  });
  it("falls back to unassigned when nothing is new, and keeps the default link", () => {
    const s = presentTickets({ kind: "ok", newCount: 0, unassignedOpen: 1, oldestNewSeconds: null });
    expect(s).toEqual({ kind: "ok", tone: "attention", headline: "1 open ticket not assigned" });
    expect(presentTickets({ kind: "ok", newCount: 0, unassignedOpen: 4, oldestNewSeconds: null })).toMatchObject({
      headline: "4 open tickets not assigned",
    });
  });
  it("is clear only when everything is zero", () => {
    expect(presentTickets({ kind: "ok", newCount: 0, unassignedOpen: 0, oldestNewSeconds: null })).toMatchObject({
      tone: "clear",
      headline: "Nothing waiting.",
    });
  });
});

describe("feedback", () => {
  it("says how many are new, or all-clear", () => {
    expect(presentFeedback({ kind: "ok", newCount: 3 })).toMatchObject({ tone: "attention", headline: "3 new" });
    expect(presentFeedback({ kind: "ok", newCount: 0 })).toMatchObject({ tone: "clear", headline: "Nothing waiting." });
  });
});

describe("contact messages", () => {
  it("says how many are new, or all-clear, and never carries a message", () => {
    expect(presentContactMessages({ kind: "ok", newCount: 2 })).toEqual({ kind: "ok", tone: "attention", headline: "2 new" });
    expect(presentContactMessages({ kind: "ok", newCount: 0 })).toMatchObject({ tone: "clear", headline: "Nothing waiting." });
  });
});

describe("email", () => {
  it("leads with failed, states the 30-minute threshold, and links to failed", () => {
    expect(presentEmail({ kind: "ok", failed: 2, overdue: 5 })).toEqual({
      kind: "ok",
      tone: "attention",
      headline: "2 failed",
      lines: ["5 waiting to send for over 30 minutes"],
      href: "/admin/email-queue?status=failed",
    });
  });
  it("leads with overdue when none failed and links to queued", () => {
    expect(presentEmail({ kind: "ok", failed: 0, overdue: 1 })).toEqual({
      kind: "ok",
      tone: "attention",
      headline: "1 waiting over 30 minutes",
      href: "/admin/email-queue?status=queued",
    });
  });
  it("is clear when both are zero", () => {
    expect(presentEmail({ kind: "ok", failed: 0, overdue: 0 })).toMatchObject({ tone: "clear" });
  });
});

describe("giving", () => {
  it("leads with dead letters, then waiting, then restricted", () => {
    expect(presentGiving({ kind: "ok", connections: 4, waiting: 2, deadLetters: 1, restricted: 3 })).toEqual({
      kind: "ok",
      tone: "attention",
      headline: "1 dead letter",
      lines: ["2 notices waiting", "3 connections restricted"],
    });
    expect(presentGiving({ kind: "ok", connections: 4, waiting: 1, deadLetters: 0, restricted: 1 })).toMatchObject({
      headline: "1 notice waiting",
      lines: ["1 connection restricted"],
    });
    expect(presentGiving({ kind: "ok", connections: 4, waiting: 0, deadLetters: 0, restricted: 2 })).toMatchObject({
      headline: "2 connections restricted",
    });
  });
  it("is clear, and counts connections only when there are some", () => {
    expect(presentGiving({ kind: "ok", connections: 1, waiting: 0, deadLetters: 0, restricted: 0 })).toEqual({
      kind: "ok",
      tone: "clear",
      headline: "Nothing waiting.",
      lines: ["1 connection"],
    });
    expect(presentGiving({ kind: "ok", connections: 0, waiting: 0, deadLetters: 0, restricted: 0 })).toMatchObject({
      lines: undefined,
    });
  });
});

describe("domains (E23)", () => {
  it("agrees in number and links to the attention filter", () => {
    expect(presentDomains({ kind: "ok", needAttention: 1 })).toEqual({
      kind: "ok",
      tone: "attention",
      headline: "1 domain needs attention",
      href: "/admin/organizations/domains?filter=attention",
    });
    expect(presentDomains({ kind: "ok", needAttention: 3 })).toMatchObject({ headline: "3 domains need attention" });
    expect(presentDomains({ kind: "ok", needAttention: 0 })).toMatchObject({ tone: "clear" });
  });
});

describe("sites", () => {
  it("leads with suspended, then provisioning, and shows live", () => {
    expect(presentSites({ kind: "ok", live: 5, provisioning: 2, suspended: 1 })).toEqual({
      kind: "ok",
      tone: "attention",
      headline: "1 suspended",
      lines: ["2 provisioning", "5 live"],
    });
    expect(presentSites({ kind: "ok", live: 5, provisioning: 2, suspended: 0 })).toMatchObject({
      headline: "2 provisioning",
      lines: ["5 live"],
    });
  });
  it("is clear with the live count when any", () => {
    expect(presentSites({ kind: "ok", live: 3, provisioning: 0, suspended: 0 })).toEqual({
      kind: "ok",
      tone: "clear",
      headline: "Nothing waiting.",
      lines: ["3 live"],
    });
    expect(presentSites({ kind: "ok", live: 0, provisioning: 0, suspended: 0 })).toMatchObject({ lines: undefined });
  });
});

describe("two-factor and locked accounts", () => {
  it("say what the number is, in the page's own words", () => {
    expect(presentTwoFactor({ kind: "ok", notEnrolled: 1 })).toEqual({
      kind: "ok",
      tone: "attention",
      headline: "1 account not enrolled",
      lines: ["Required to use two-factor, but not enrolled."],
    });
    expect(presentTwoFactor({ kind: "ok", notEnrolled: 2 })).toMatchObject({ headline: "2 accounts not enrolled" });
    expect(presentAccounts({ kind: "ok", locked: 2 })).toEqual({
      kind: "ok",
      tone: "attention",
      headline: "2 locked",
      lines: ["Locked after too many failed sign-ins."],
    });
    expect(presentTwoFactor({ kind: "ok", notEnrolled: 0 })).toMatchObject({ tone: "clear" });
    expect(presentAccounts({ kind: "ok", locked: 0 })).toMatchObject({ tone: "clear" });
  });
});

describe("organizations at a glance", () => {
  const zeroType = { general_assembly: 0, synod: 0, presbytery: 0, congregation: 0, new_worshiping_community: 0 };
  const zeroStatus = { managed: 0, invited: 0, unmanaged: 0 };

  it("is neutral, shows only non-zero lines, and links to the list", () => {
    const s = presentOrganizations({
      kind: "ok",
      total: 5,
      byType: { ...zeroType, congregation: 3, presbytery: 1, new_worshiping_community: 1 },
      byStatus: { managed: 2, invited: 0, unmanaged: 3 },
      inactive: 1,
      defaultPalette: 4,
    });
    expect(s).toEqual({
      kind: "ok",
      tone: "neutral",
      headline: "5 organizations",
      lines: [
        "3 congregations, 1 presbytery, 1 new worshiping community",
        "2 managed, 3 unmanaged",
        "1 no longer active",
        "4 still on the default palette",
      ],
    });
  });
  it("singular headline and no empty lines", () => {
    const s = presentOrganizations({
      kind: "ok",
      total: 1,
      byType: { ...zeroType, synod: 1 },
      byStatus: { ...zeroStatus, managed: 1 },
      inactive: 0,
      defaultPalette: 0,
    });
    expect(s).toMatchObject({ headline: "1 organization", lines: ["1 synod", "1 managed"] });
  });
  it("zero organizations invites the first one and links to the create page (G5)", () => {
    expect(
      presentOrganizations({ kind: "ok", total: 0, byType: zeroType, byStatus: zeroStatus, inactive: 0, defaultPalette: 0 }),
    ).toEqual({
      kind: "ok",
      tone: "neutral",
      headline: "No organizations yet.",
      lines: ["Create the first one."],
      href: "/admin/organizations/new",
    });
  });
});
