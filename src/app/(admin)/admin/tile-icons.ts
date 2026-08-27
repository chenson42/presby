import {
  FileText,
  KeyRound,
  Landmark,
  Mail,
  Megaphone,
  MessageSquare,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AdminTile } from "@/lib/admin-portal/tiles";

/**
 * The platform-portal's tile-key → icon lookup — the admin-axis mirror of
 * `src/components/org-portal/tile-icons.tsx` (docs/work-log/
 * 2026-08-27-platform-home-and-portal.md, Phase 3). All ten glyphs are
 * pre-existing `lucide-react` icons (already a dependency — no new
 * dependency, no architect five-criteria pass needed).
 */
export const ADMIN_TILE_ICONS: Record<AdminTile["key"], LucideIcon> = {
  users: Users,
  "2fa": KeyRound,
  organizations: Landmark,
  flags: SlidersHorizontal,
  audit: ShieldCheck,
  email_queue: Mail,
  docs: FileText,
  whats_new: Megaphone,
  feedback: MessageSquare,
  tickets: Ticket,
};
