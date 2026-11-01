import { Badge as UiBadge } from "@/components/ui/badge";
import type { CommunityBadge as Badge, EngagementBadge as Engagement } from "@/lib/community";

/** Plain-language badge labels (Phase 3 copy table). "Waiting for the Session"
 * is the person with a pending roll action and no roll yet. Type-only import
 * of `community.ts` (server-only) is erased at build, so this stays client-safe. */
export const BADGE_LABELS: Record<Badge, string> = {
  active: "Active member",
  baptized: "Baptized member",
  affiliate: "Affiliate member",
  participant: "Participant",
  visitor: "Visitor",
  waiting: "Waiting for the Session",
};

/** Member rolls read as the quiet "secondary" badge, the other connections as
 * an outline, and "waiting" borrows the amber the pending notices already use,
 * so it reads as unfinished rather than as a status. */
const BADGE_VARIANT: Record<Badge, "secondary" | "outline"> = {
  active: "secondary",
  baptized: "secondary",
  affiliate: "secondary",
  participant: "outline",
  visitor: "outline",
  waiting: "outline",
};

const WAITING_CLASSES =
  "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";

export function CommunityBadge({ badge }: { badge: Badge }) {
  return (
    <UiBadge
      variant={BADGE_VARIANT[badge]}
      className={badge === "waiting" ? WAITING_CLASSES : undefined}
    >
      {BADGE_LABELS[badge]}
    </UiBadge>
  );
}

/** The engagement badge beside a rolled person's roll badge (Copy group C):
 * the roll lists them whatever their engagement, and this says how they are
 * marked. Outline, like the other non-member badges; the word is the signal. */
export const ENGAGEMENT_BADGE_LABELS: Record<Engagement, string> = {
  inactive: "Inactive",
  moved_away: "Moved away",
};

export function EngagementStatusBadge({ engagement }: { engagement: Engagement }) {
  return <UiBadge variant="outline">{ENGAGEMENT_BADGE_LABELS[engagement]}</UiBadge>;
}
