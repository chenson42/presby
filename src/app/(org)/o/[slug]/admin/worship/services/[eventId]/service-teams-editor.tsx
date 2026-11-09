"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import { Field, SELECT_CLASSES, SelectBox } from "@/components/worship/form-bits";
import { ACTION_COPY, NAV_COPY, SERVICES_COPY } from "@/lib/worship/copy";
import { setServiceTeamsAction } from "../../actions";

/**
 * "Teams serving" (Copy G4): the teams on this service, each with "Remove", and "Add
 * a team" from the teams not yet serving. A team with a live assignment on this
 * service cannot be removed - the store answers with its own sentence, toasted here.
 * Each change sends the whole list (the action replaces the set).
 */
export function ServiceTeamsEditor({
  slug,
  eventId,
  serving,
  allTeams,
}: {
  slug: string;
  eventId: string;
  serving: Array<{ groupId: string; name: string }>;
  allTeams: Array<{ groupId: string; name: string }>;
}) {
  const router = useRouter();
  const available = allTeams.filter((t) => !serving.some((s) => s.groupId === t.groupId));
  const [picked, setPicked] = useState(available[0]?.groupId ?? "");
  // The chosen team may have just been added (the list re-reads); fall back to the first still available.
  const choice = available.some((t) => t.groupId === picked) ? picked : (available[0]?.groupId ?? "");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function save(groupIds: string[]) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await setServiceTeamsAction(slug, { eventId, groupIds });
      if (result.ok) {
        toast.success(SERVICES_COPY.page.editToast);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(ACTION_COPY.generic);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      {serving.length === 0 ? (
        <p className="text-base text-muted-foreground">{NAV_COPY.noServingTeams}</p>
      ) : (
        <ul className="space-y-2">
          {serving.map((team) => (
            <li key={team.groupId} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-base font-medium [overflow-wrap:anywhere]">{team.name}</span>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={pending}
                onClick={() => void save(serving.filter((s) => s.groupId !== team.groupId).map((s) => s.groupId))}
              >
                {SERVICES_COPY.page.removeTeam}
                <span className="sr-only"> {team.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {available.length === 0 ? (
        serving.length > 0 && <p className="text-sm text-muted-foreground">{NAV_COPY.noTeamsToAdd}</p>
      ) : (
        <HydrationGate>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (choice) void save([...serving.map((s) => s.groupId), choice]);
            }}
            className="space-y-3 rounded-lg border border-border bg-card p-3"
          >
            <Field id="add-team" label={SERVICES_COPY.page.addTeam}>
              <SelectBox>
                <select id="add-team" className={SELECT_CLASSES} value={choice} onChange={(e) => setPicked(e.target.value)}>
                  {available.map((team) => (
                    <option key={team.groupId} value={team.groupId}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </SelectBox>
            </Field>
            <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={pending}>
              {SERVICES_COPY.page.addTeam}
            </Button>
          </form>
        </HydrationGate>
      )}
    </div>
  );
}
