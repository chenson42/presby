import {
  HandCoins,
  Landmark,
  ListOrdered,
  PiggyBank,
  Settings as SettingsIcon,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { OrgAccessError, withOrgContext } from "@/lib/authz";
import { loadAttention, type Attention } from "@/lib/giving/attention";
import { TileGrid } from "@/components/shared/tile-grid";
import { AttentionList } from "./attention-list";
import { ConnectionPlaceholderCard } from "./connection-placeholder-card";
import { GivingLoadError } from "./giving-admin-states";
import { gateGivingPage, type GivingNeedKey } from "./giving-page-gate";

/**
 * `/o/<slug>/admin/giving` - the giving administration overview.
 * docs/work-log/2026-10-15-online-giving.md, Batch 1b (the toggle-aware shell)
 * and Batch 2 (the non-Stripe cards).
 *
 * THE GATE IS `gateGivingPage()` (see its header for the order): sign-in ->
 * four-way org miss -> `assertOrgAccess` -> Node-side 2FA -> org-type and org
 * toggle ("off" is an honest state at HTTP 200, never a 404) -> any one of the
 * three giving keys. Everything below renders only for a viewer who passed it.
 *
 * WHAT IT SHOWS, and to whom (S4/S5):
 *   - "Needs attention": `loadAttention()` is the ONE definition. A recorder
 *     (`giving.record` alone) is told one thing - donor link suggestions - and
 *     nothing else; they read no ledger, no totals, no provider state.
 *   - the "Online giving" card (`giving.manage`): a placeholder until Batch 3
 *     lands the Stripe connection panel. Said plainly, not hidden.
 *   - one tile per area the viewer's keys open: Record a gift, Gifts, Donors,
 *     Funds, Settings, Team. A tile is shown only when its destination will
 *     admit the viewer, so no tile leads to a Forbidden page.
 *
 * NO `loading.tsx` on this segment, by design: every `(org)` page can
 * `notFound()` or redirect on the four-way miss, and a `loading.tsx` would
 * flush a 200 before either resolves (CLAUDE.md, "The (org) contract").
 * `/o/[slug]/error.tsx` catches an unexpected throw.
 */

interface AreaTile {
  key: string;
  label: string;
  description: string;
  domain: "giving";
  /** Path under `/o/<slug>/admin/giving/`. */
  path: string;
  /** Shown when the viewer holds ANY of these keys. */
  anyOf: readonly GivingNeedKey[];
  icon: LucideIcon;
}

const AREAS: readonly AreaTile[] = [
  {
    key: "record",
    label: "Record a gift",
    description: "Enter cash, check, stock or other gifts that arrived by hand.",
    domain: "giving",
    path: "gifts/new",
    anyOf: ["record"],
    icon: HandCoins,
  },
  {
    key: "gifts",
    label: "Gifts",
    description: "Every gift, with filters and a CSV download for your books.",
    domain: "giving",
    path: "gifts",
    anyOf: ["view"],
    icon: ListOrdered,
  },
  {
    key: "recent",
    label: "Your recent entries",
    description: "The gifts you recorded in the last 30 days, and a way to void one.",
    domain: "giving",
    path: "gifts",
    anyOf: ["record"],
    icon: ListOrdered,
  },
  {
    key: "donors",
    label: "Donors",
    description: "Everyone who gives, their contact details and links to members.",
    domain: "giving",
    path: "donors",
    anyOf: ["view", "record"],
    icon: Users,
  },
  {
    key: "funds",
    label: "Funds",
    description: "The designations gifts can go to, and which are offered online.",
    domain: "giving",
    path: "funds",
    anyOf: ["manage"],
    icon: PiggyBank,
  },
  {
    key: "settings",
    label: "Statement details",
    description: "The name, address and signature printed on year-end statements.",
    domain: "giving",
    path: "settings",
    anyOf: ["manage"],
    icon: SettingsIcon,
  },
  {
    key: "team",
    label: "Giving team",
    description: "Who can record gifts, view giving and manage it.",
    domain: "giving",
    path: "team",
    anyOf: ["manage"],
    icon: UsersRound,
  },
];

export default async function GivingAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/giving`;

  const gate = await gateGivingPage({
    slug,
    path,
    anyOf: ["view", "record", "manage"],
    section: "Giving",
  });
  if (!gate.ok) return gate.node;

  let attention: Attention;
  try {
    attention = await withOrgContext(gate.org.personId, gate.org.organizationId, (tx) =>
      loadAttention(tx, { organizationId: gate.org.organizationId, has: gate.has }),
    );
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <GivingLoadError slug={slug} />;
  }

  // "Your recent entries" duplicates "Gifts" for someone who holds both keys.
  const tiles = AREAS.filter(
    (area) =>
      area.anyOf.some((key) => gate.has[key]) && !(area.key === "recent" && gate.has.view),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Giving</h1>
        <p className="mt-1 text-sm text-muted-foreground">{gate.org.name}</p>
      </div>

      <section aria-labelledby="giving-attention" className="space-y-3">
        <h2 id="giving-attention" className="text-xl font-semibold">
          Needs attention
        </h2>
        <AttentionList attention={attention} slug={slug} />
      </section>

      {gate.has.manage && (
        <section aria-labelledby="giving-online" className="space-y-3">
          <h2 id="giving-online" className="text-xl font-semibold">
            Online giving
          </h2>
          <ConnectionPlaceholderCard />
        </section>
      )}

      <section aria-labelledby="giving-areas" className="space-y-3">
        <h2 id="giving-areas" className="text-xl font-semibold">
          Giving tools
        </h2>
        <TileGrid
          tiles={tiles}
          getHref={(tile) => `${path}/${tile.path}`}
          getIcon={(tile) => tile.icon ?? Landmark}
        />
      </section>
    </div>
  );
}
