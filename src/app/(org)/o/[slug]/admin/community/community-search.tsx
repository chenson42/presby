import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CommunityView } from "@/lib/community-labels";

/**
 * The zero-JS GET search form, extracted from the old members list. The view
 * rides along as a hidden field so a search stays inside the current filter.
 * (The status `<select>` is retired: the nav's Members / Participants links
 * replace it.)
 */
export function CommunitySearch({
  view,
  search,
}: {
  view: CommunityView;
  search: string;
}) {
  return (
    <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
      {view !== "all" && <input type="hidden" name="view" value={view} />}
      <div className="flex-1">
        <Label htmlFor="community-search" className="text-sm">
          Search people
        </Label>
        <Input
          id="community-search"
          name="search"
          type="search"
          defaultValue={search}
          placeholder="Name or email"
          className="mt-1 min-h-11"
        />
      </div>
      <Button type="submit" className="min-h-11 sm:w-auto">
        Search
      </Button>
    </form>
  );
}
