import { Badge } from "@/components/ui/badge";
import { roleLabel } from "@/lib/committees/copy";
import type { GroupRoleValue } from "@/lib/group-roles";

/** A seat's title. Always shown, on every width (the roster never hides the role). */
export function RoleBadge({ role }: { role: GroupRoleValue }) {
  return <Badge variant={role === "chair" ? "default" : "outline"}>{roleLabel(role)}</Badge>;
}
