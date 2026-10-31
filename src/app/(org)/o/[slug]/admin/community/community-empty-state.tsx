import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { CommunityView } from "@/lib/community-labels";

const VIEW_NAMES: Record<CommunityView, string> = {
  all: "people",
  members: "members",
  participants: "participants",
  visitors: "visitors",
  inactive: "inactive people",
  staff: "staff",
  former: "former people",
};

/**
 * Empty state for every Community view (Phase 3 copy table). A search that
 * matched nobody is told apart from "the view is genuinely empty" (the
 * `directory-grid.tsx` discipline): the first says so, the second says what to
 * do next.
 */
export function CommunityEmptyState({
  slug,
  view,
  search,
  canManage,
  canStaffLink,
}: {
  slug: string;
  view: CommunityView;
  search: string;
  canManage: boolean;
  /** `org_portal.staff` is on and the viewer holds `staff.manage`. */
  canStaffLink: boolean;
}) {
  if (search) {
    return (
      <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        {`No ${VIEW_NAMES[view]} match "${search}". Try a different name or email.`}
      </p>
    );
  }

  const addPerson =
    canManage && view !== "staff" && view !== "former" && view !== "members" && view !== "inactive";

  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-16 text-center">
      <p className="text-sm font-medium">{headline(view)}</p>
      {detail(view) && (
        <p className="mt-1 text-sm text-muted-foreground">{detail(view)}</p>
      )}
      {view === "staff" && canStaffLink && (
        <p className="mt-2 text-sm text-muted-foreground">
          Staff positions are recorded on the{" "}
          <Link
            href={`/o/${slug}/admin/staff`}
            className="underline underline-offset-2"
          >
            Staff page
          </Link>
          .
        </p>
      )}
      {addPerson && (
        <Button asChild className="mt-4 min-h-11">
          <Link href={`/o/${slug}/admin/community/new`}>Add person</Link>
        </Button>
      )}
    </div>
  );
}

function headline(view: CommunityView): string {
  switch (view) {
    case "all":
      return "No one yet";
    case "members":
      return "No members yet";
    case "participants":
      return "No participants yet";
    case "visitors":
      return "No visitors yet";
    case "inactive":
      return "No one is marked inactive or moved away";
    case "staff":
      return "No one holds a staff position yet";
    case "former":
      return "No former participants";
  }
}

function detail(view: CommunityView): string {
  switch (view) {
    case "all":
      return "Add your first person to get started. Staff contacts appear under Staff once a position is recorded.";
    case "members":
      return "People appear here once the Session approves their roll action.";
    case "participants":
      return "Add a person and choose Participant.";
    case "visitors":
      return "Add a visitor to keep track of who is coming.";
    case "inactive":
      return "People on the roll who are marked inactive stay under Members or Participants.";
    case "staff":
      return "";
    case "former":
      return "";
  }
}
