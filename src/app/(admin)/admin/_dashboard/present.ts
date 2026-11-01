import { formatAge } from "@/lib/admin/format-age";
import { HELP_CONTACT_INBOX_COPY } from "@/lib/help-contact/copy";
import type { CountCardState } from "@/components/shared/count-card";
import type { CardResult } from "@/lib/admin-portal/dashboard/read-card";
import type { TicketsCard } from "@/lib/admin-portal/dashboard/tickets";
import type { FeedbackCard } from "@/lib/admin-portal/dashboard/feedback";
import type { ContactMessagesCard } from "@/lib/admin-portal/dashboard/messages";
import type { EmailCard } from "@/lib/admin-portal/dashboard/email";
import type { GivingCard } from "@/lib/admin-portal/dashboard/giving";
import type { DomainsCard } from "@/lib/admin-portal/dashboard/domains";
import type { SitesCard } from "@/lib/admin-portal/dashboard/sites";
import type { TwoFactorCard } from "@/lib/admin-portal/dashboard/two-factor";
import type { AccountsCard } from "@/lib/admin-portal/dashboard/accounts";
import type { OrganizationsCard } from "@/lib/admin-portal/dashboard/organizations";

/**
 * Presenters: a reader's `CardResult` becomes a `CountCardState`. PURE, and
 * where ALL the card copy lives (Phase 3 Copy, group D), so it is unit-tested
 * without rendering a server component.
 *
 * A failed read is its own state and can never reach "Nothing waiting."
 * (U2, E5): every presenter's first line is the error branch, and the success
 * branches only ever see counts from a read that completed.
 */
export const DASHBOARD_HREF = "/admin";
export const ALL_CLEAR = "Nothing waiting.";

const ERROR: CountCardState = { kind: "error", retryHref: DASHBOARD_HREF };

/** "1 domain" / "3 domains". */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function clear(lines?: string[]): CountCardState {
  return { kind: "ok", tone: "clear", headline: ALL_CLEAR, lines };
}

export function presentTickets(r: CardResult<TicketsCard>): CountCardState {
  if (r.kind === "error") return ERROR;
  const lines: string[] = [];
  if (r.newCount > 0) {
    if (r.oldestNewSeconds !== null) {
      lines.push(`Oldest new ticket has waited ${formatAge(r.oldestNewSeconds)}`);
    }
    if (r.unassignedOpen > 0) lines.push(`${r.unassignedOpen} open and not assigned`);
    return {
      kind: "ok",
      tone: "attention",
      headline: count(r.newCount, "new ticket"),
      lines,
      href: "/admin/tickets?status=new",
    };
  }
  if (r.unassignedOpen > 0) {
    return {
      kind: "ok",
      tone: "attention",
      headline: `${count(r.unassignedOpen, "open ticket")} not assigned`,
    };
  }
  return clear();
}

export function presentFeedback(r: CardResult<FeedbackCard>): CountCardState {
  if (r.kind === "error") return ERROR;
  if (r.newCount > 0) {
    return { kind: "ok", tone: "attention", headline: `${r.newCount} new` };
  }
  return clear();
}

/** The contact-form inbox: a count of `new` messages (a content-free email makes this the real signal, FC4). */
export function presentContactMessages(r: CardResult<ContactMessagesCard>): CountCardState {
  if (r.kind === "error") return ERROR;
  if (r.newCount > 0) {
    return { kind: "ok", tone: "attention", headline: HELP_CONTACT_INBOX_COPY.cardNew(r.newCount) };
  }
  return clear();
}

export function presentEmail(r: CardResult<EmailCard>): CountCardState {
  if (r.kind === "error") return ERROR;
  if (r.failed > 0) {
    return {
      kind: "ok",
      tone: "attention",
      headline: `${r.failed} failed`,
      lines:
        r.overdue > 0
          ? [`${r.overdue} waiting to send for over 30 minutes`]
          : undefined,
      href: "/admin/email-queue?status=failed",
    };
  }
  if (r.overdue > 0) {
    return {
      kind: "ok",
      tone: "attention",
      headline: `${r.overdue} waiting over 30 minutes`,
      href: "/admin/email-queue?status=queued",
    };
  }
  return clear();
}

export function presentGiving(r: CardResult<GivingCard>): CountCardState {
  if (r.kind === "error") return ERROR;
  const parts: string[] = [];
  if (r.deadLetters > 0) parts.push(count(r.deadLetters, "dead letter"));
  if (r.waiting > 0) parts.push(`${count(r.waiting, "notice")} waiting`);
  if (r.restricted > 0) parts.push(`${count(r.restricted, "connection")} restricted`);
  if (parts.length === 0) {
    return clear(
      r.connections > 0 ? [count(r.connections, "connection")] : undefined,
    );
  }
  const [headline, ...lines] = parts;
  return {
    kind: "ok",
    tone: "attention",
    headline,
    lines: lines.length > 0 ? lines : undefined,
  };
}

export function presentDomains(r: CardResult<DomainsCard>): CountCardState {
  if (r.kind === "error") return ERROR;
  if (r.needAttention > 0) {
    const n = r.needAttention;
    return {
      kind: "ok",
      tone: "attention",
      headline: `${n} ${n === 1 ? "domain needs" : "domains need"} attention`,
      href: "/admin/organizations/domains?filter=attention",
    };
  }
  return clear();
}

export function presentSites(r: CardResult<SitesCard>): CountCardState {
  if (r.kind === "error") return ERROR;
  const live = r.live > 0 ? `${r.live} live` : null;
  if (r.suspended > 0) {
    const lines = [
      r.provisioning > 0 ? `${r.provisioning} provisioning` : null,
      live,
    ].filter((l): l is string => l !== null);
    return {
      kind: "ok",
      tone: "attention",
      headline: `${r.suspended} suspended`,
      lines: lines.length > 0 ? lines : undefined,
    };
  }
  if (r.provisioning > 0) {
    return {
      kind: "ok",
      tone: "attention",
      headline: `${r.provisioning} provisioning`,
      lines: live ? [live] : undefined,
    };
  }
  return clear(live ? [live] : undefined);
}

export function presentTwoFactor(r: CardResult<TwoFactorCard>): CountCardState {
  if (r.kind === "error") return ERROR;
  if (r.notEnrolled > 0) {
    return {
      kind: "ok",
      tone: "attention",
      headline: `${count(r.notEnrolled, "account")} not enrolled`,
      lines: ["Required to use two-factor, but not enrolled."],
    };
  }
  return clear();
}

export function presentAccounts(r: CardResult<AccountsCard>): CountCardState {
  if (r.kind === "error") return ERROR;
  if (r.locked > 0) {
    return {
      kind: "ok",
      tone: "attention",
      headline: `${r.locked} locked`,
      lines: ["Locked after too many failed sign-ins."],
    };
  }
  return clear();
}

const TYPE_WORDS: ReadonlyArray<[keyof OrganizationsCard["byType"], string, string]> = [
  ["congregation", "congregation", "congregations"],
  ["presbytery", "presbytery", "presbyteries"],
  ["synod", "synod", "synods"],
  ["general_assembly", "general assembly", "general assemblies"],
  ["new_worshiping_community", "new worshiping community", "new worshiping communities"],
];

const STATUS_WORDS: ReadonlyArray<[keyof OrganizationsCard["byStatus"], string]> = [
  ["managed", "managed"],
  ["invited", "invited"],
  ["unmanaged", "unmanaged"],
];

export function presentOrganizations(
  r: CardResult<OrganizationsCard>,
): CountCardState {
  if (r.kind === "error") return ERROR;
  if (r.total === 0) {
    return {
      kind: "ok",
      tone: "neutral",
      headline: "No organizations yet.",
      lines: ["Create the first one."],
      href: "/admin/organizations/new",
    };
  }
  const byType = TYPE_WORDS.filter(([k]) => r.byType[k] > 0).map(
    ([k, one, many]) => `${r.byType[k]} ${r.byType[k] === 1 ? one : many}`,
  );
  const byStatus = STATUS_WORDS.filter(([k]) => r.byStatus[k] > 0).map(
    ([k, word]) => `${r.byStatus[k]} ${word}`,
  );
  const lines = [
    byType.length > 0 ? byType.join(", ") : null,
    byStatus.length > 0 ? byStatus.join(", ") : null,
    r.inactive > 0 ? `${r.inactive} no longer active` : null,
    r.defaultPalette > 0 ? `${r.defaultPalette} still on the default palette` : null,
  ].filter((l): l is string => l !== null);
  return {
    kind: "ok",
    tone: "neutral",
    headline: count(r.total, "organization"),
    lines,
  };
}
