import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_Q_LENGTH } from "../organizations/org-tree";

/**
 * "Find an organization": a plain GET form to the organizations list, which
 * already filters on `?q=`. Not a `useForm` root, so no `HydrationGate` is
 * required (nothing here writes data and nothing is controlled), and a submit
 * before hydration still works natively. Stacks on a phone: input full width
 * above the button, both 44px.
 */
export function FindOrganization() {
  return (
    <form
      method="get"
      action="/admin/organizations"
      role="search"
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <div className="space-y-1">
        <Label htmlFor="dashboard-find-org">Find an organization</Label>
        <Input
          id="dashboard-find-org"
          name="q"
          type="search"
          maxLength={MAX_Q_LENGTH}
          autoComplete="off"
          placeholder="Part of a name"
          className="min-h-11 sm:w-64"
        />
      </div>
      <Button type="submit" variant="outline" className="min-h-11">
        Search
      </Button>
    </form>
  );
}
