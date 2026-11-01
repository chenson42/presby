import type { ComponentType } from "react";
import {
  Globe,
  Inbox,
  KeyRound,
  Landmark,
  LayoutTemplate,
  Lock,
  Mail,
  MessageSquare,
  Ticket,
  HandCoins,
} from "lucide-react";
import { CountCard } from "@/components/shared/count-card";
import { HELP_CONTACT_INBOX_COPY } from "@/lib/help-contact/copy";
import { readTicketsCard } from "@/lib/admin-portal/dashboard/tickets";
import { readFeedbackCard } from "@/lib/admin-portal/dashboard/feedback";
import { readContactMessagesCard } from "@/lib/admin-portal/dashboard/messages";
import { readEmailCard } from "@/lib/admin-portal/dashboard/email";
import { readGivingCard } from "@/lib/admin-portal/dashboard/giving";
import { readDomainsCard } from "@/lib/admin-portal/dashboard/domains";
import { readSitesCard } from "@/lib/admin-portal/dashboard/sites";
import { readTwoFactorCard } from "@/lib/admin-portal/dashboard/two-factor";
import { readAccountsCard } from "@/lib/admin-portal/dashboard/accounts";
import { readOrganizationsCard } from "@/lib/admin-portal/dashboard/organizations";
import {
  presentAccounts,
  presentDomains,
  presentEmail,
  presentFeedback,
  presentContactMessages,
  presentGiving,
  presentOrganizations,
  presentSites,
  presentTickets,
  presentTwoFactor,
} from "./present";
import { RecentChangesCard } from "./recent-changes-card";
import type { DashboardCardId } from "./registry";

/**
 * The dashboard's async card components, one per reader. Each is a THIN
 * wrapper: await the reader, hand the result to its presenter, render
 * `CountCard`. All wording lives in `present.ts` and is tested there.
 *
 * Each card is mounted by the page inside its own `Suspense` and ONLY for a
 * viewer who holds its key, so a reader never runs for a non-holder (E4).
 * They live in one file so a page test can replace the whole map with
 * synchronous stubs (RTL cannot render an async server component inside
 * `Suspense`); the wrappers are tested by calling them directly.
 *
 * No auth or feature check here, on purpose: the caller owns that.
 */
export async function OrganizationsCardView() {
  return (
    <CountCard
      title="Organizations at a glance"
      icon={Landmark}
      href="/admin/organizations"
      state={presentOrganizations(await readOrganizationsCard())}
    />
  );
}

export async function GivingCardView() {
  return (
    <CountCard
      title="Giving notices"
      icon={HandCoins}
      href="/admin/giving"
      state={presentGiving(await readGivingCard())}
    />
  );
}

export async function DomainsCardView() {
  return (
    <CountCard
      title="Domains"
      icon={Globe}
      href="/admin/organizations/domains"
      state={presentDomains(await readDomainsCard())}
    />
  );
}

export async function SitesCardView() {
  return (
    <CountCard
      title="Sites"
      icon={LayoutTemplate}
      href="/admin/sites"
      state={presentSites(await readSitesCard())}
    />
  );
}

export async function TicketsCardView() {
  return (
    <CountCard
      title="Tickets"
      icon={Ticket}
      href="/admin/tickets"
      state={presentTickets(await readTicketsCard())}
    />
  );
}

export async function FeedbackCardView() {
  return (
    <CountCard
      title="Feedback"
      icon={MessageSquare}
      href="/admin/feedback"
      state={presentFeedback(await readFeedbackCard())}
    />
  );
}

export async function ContactMessagesCardView() {
  return (
    <CountCard
      title={HELP_CONTACT_INBOX_COPY.title}
      icon={Inbox}
      href="/admin/messages"
      state={presentContactMessages(await readContactMessagesCard())}
    />
  );
}

export async function EmailCardView() {
  return (
    <CountCard
      title="Email queue"
      icon={Mail}
      href="/admin/email-queue"
      state={presentEmail(await readEmailCard())}
    />
  );
}

export async function TwoFactorCardView() {
  return (
    <CountCard
      title="Two-factor"
      icon={KeyRound}
      href="/admin/2fa"
      state={presentTwoFactor(await readTwoFactorCard())}
    />
  );
}

export async function AccountsCardView() {
  return (
    <CountCard
      title="Locked accounts"
      icon={Lock}
      href="/admin/users"
      state={presentAccounts(await readAccountsCard())}
    />
  );
}

export const DASHBOARD_CARD_VIEWS: Record<DashboardCardId, ComponentType> = {
  organizations: OrganizationsCardView,
  giving: GivingCardView,
  domains: DomainsCardView,
  sites: SitesCardView,
  tickets: TicketsCardView,
  feedback: FeedbackCardView,
  contact_messages: ContactMessagesCardView,
  email: EmailCardView,
  two_factor: TwoFactorCardView,
  accounts: AccountsCardView,
  recent_changes: RecentChangesCard as ComponentType,
};
