import { Briefcase, Clock, Eye, Heart, UserCheck, UserMinus, Users } from "lucide-react";
import { ButtonGroup, type ButtonGroupItem } from "@/components/shared/button-group";
import type { CommunityView } from "@/lib/community-labels";

/**
 * Everyone / Members / Participants, then (for `people.manage` holders) Visitors,
 * Inactive, Staff and Former. A `ButtonGroup` of real links (a GET navigation, not a
 * client tab switcher), the `directory-nav.tsx` pattern, so the page stays a
 * Server Component and the browser back button works. The current `search` is
 * carried across views. The `ButtonGroup` scrolls horizontally rather than
 * wrapping, which is what keeps seven segments one row at 360px (the current one
 * is scrolled into view and the side that overflows fades: `ButtonGroupScroll`).
 *
 * Visitors, Inactive, Staff and Former are shown only when `canManage`; the readers
 * behind them re-check `people.manage` regardless, so this is visibility, not
 * enforcement.
 */
const ITEMS: ReadonlyArray<{
  view: CommunityView;
  label: string;
  icon: ButtonGroupItem["icon"];
  adminOnly: boolean;
}> = [
  { view: "all", label: "Everyone", icon: Users, adminOnly: false },
  { view: "members", label: "Members", icon: UserCheck, adminOnly: false },
  { view: "participants", label: "Participants", icon: Heart, adminOnly: false },
  { view: "visitors", label: "Visitors", icon: Eye, adminOnly: true },
  { view: "inactive", label: "Inactive", icon: Clock, adminOnly: true },
  { view: "staff", label: "Staff", icon: Briefcase, adminOnly: true },
  { view: "former", label: "Former", icon: UserMinus, adminOnly: true },
];

export function communityHref(slug: string, view: CommunityView, search: string): string {
  const params = new URLSearchParams();
  if (view !== "all") params.set("view", view);
  if (search) params.set("search", search);
  const qs = params.toString();
  return `/o/${slug}/admin/community${qs ? `?${qs}` : ""}`;
}

export function CommunityNav({
  slug,
  view,
  search,
  canManage,
}: {
  slug: string;
  view: CommunityView;
  search: string;
  canManage: boolean;
}) {
  const items: ButtonGroupItem[] = ITEMS.filter((i) => canManage || !i.adminOnly).map(
    (i) => ({
      key: i.view,
      label: i.label,
      href: communityHref(slug, i.view, search),
      icon: i.icon,
      active: view === i.view,
      "aria-current": view === i.view ? ("page" as const) : undefined,
    }),
  );
  return <ButtonGroup items={items} aria-label="Community view" />;
}
