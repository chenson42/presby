"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, INPUT_CLASSES } from "@/components/worship/form-bits";
import { ACTION_COPY, MEMBER_COPY, NAV_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import { LIMITS } from "@/lib/worship/vocab";
import type { RosterCandidate, TeamPerson, TeamPosition } from "@/lib/worship/reads";
import { addTeamMemberAction, endTeamMemberAction, searchRosterCandidatesAction, setQualificationsAction } from "../../actions";

/**
 * The team's people (Copy G3): "Add a person" (search, then Add), each person's
 * "Can fill:" positions (a checkbox per live position, saved with "Save"), and
 * "Remove from team" (an AlertDialog). Chairs and leaders are listed with their
 * badge and are NOT removable here - they are changed under Groups ("Chairs and
 * leaders are changed under Groups."); their "Can fill:" is still editable.
 *
 * A roster whose group carries a live role grant refuses add and remove in the
 * store with the role-bound sentence; the controls stay (a `groups.manage` holder
 * may still change it) and the refusal is toasted in the store's words.
 */

function PersonCard({
  slug,
  groupId,
  teamName,
  person,
  positions,
  retired,
}: {
  slug: string;
  groupId: string;
  teamName: string;
  person: TeamPerson;
  positions: TeamPosition[];
  retired: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>(person.positionIds);
  const [pending, setPending] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const busy = useRef(false);
  const names = positions.filter((p) => person.positionIds.includes(p.id)).map((p) => p.name);
  const badge = person.role === "chair" ? TEAMS_COPY.page.chairBadge : person.role === "leader" ? TEAMS_COPY.page.leaderBadge : null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await setQualificationsAction(slug, { groupId, personId: person.personId, positionIds: picked });
      if (result.ok) {
        toast.success(TEAMS_COPY.page.qualificationsSaved);
        setEditing(false);
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

  async function remove() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await endTeamMemberAction(slug, { groupId, groupMembershipId: person.groupMembershipId });
      if (result.ok) {
        toast.success(TEAMS_COPY.removeDialog.toast);
        setRemoveOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
        setRemoveOpen(false);
      }
    } catch {
      toast.error(ACTION_COPY.generic);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <li className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid="roster-person">
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-lg font-semibold [overflow-wrap:anywhere]">
          {person.displayName}
          {badge && <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-sm font-normal">{badge}</span>}
        </p>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {TEAMS_COPY.page.canFillLabel} {names.length > 0 ? names.join(", ") : "-"}
        </p>
        {person.role !== "member" && <p className="text-sm text-muted-foreground">{TEAMS_COPY.validation.seatsUnderGroups}</p>}
      </div>

      {editing ? (
        <HydrationGate>
          <form onSubmit={save} className="space-y-3">
            <fieldset className="space-y-1">
              <legend className="sr-only">{TEAMS_COPY.page.canFillLabel}</legend>
              {positions.map((position) => (
                <label key={position.id} className="flex min-h-11 items-center gap-3 text-base [overflow-wrap:anywhere]">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-primary"
                    checked={picked.includes(position.id)}
                    onChange={() => toggle(position.id)}
                  />
                  {position.name}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" className="min-h-11" disabled={pending}>
                {TEAMS_COPY.page.saveQualifications}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={pending}
                onClick={() => {
                  setPicked(person.positionIds);
                  setEditing(false);
                }}
              >
                {NAV_COPY.cancel}
              </Button>
            </div>
          </form>
        </HydrationGate>
      ) : (
        !retired && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {positions.length > 0 && (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setEditing(true)}>
                {TEAMS_COPY.page.canFillLabel.replace(/:$/, "")}
                <span className="sr-only"> {person.displayName}</span>
              </Button>
            )}
            {person.role === "member" && (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setRemoveOpen(true)}>
                {TEAMS_COPY.page.removeFromTeam}
                <span className="sr-only"> {person.displayName}</span>
              </Button>
            )}
          </div>
        )
      )}

      <AlertDialog open={removeOpen} onOpenChange={(next) => !pending && setRemoveOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">{TEAMS_COPY.removeDialog.title(person.displayName, teamName)}</AlertDialogTitle>
            <AlertDialogDescription>{TEAMS_COPY.removeDialog.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={pending}>
              {TEAMS_COPY.removeDialog.cancel}
            </AlertDialogCancel>
            <Button type="button" variant="destructive" className="min-h-11" disabled={pending} onClick={remove} data-testid="remove-member-confirm">
              {TEAMS_COPY.removeDialog.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function AddPerson({ slug, groupId }: { slug: string; groupId: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RosterCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const run = useRef(0);

  async function search(next: string) {
    setQ(next);
    const id = ++run.current;
    if (next.trim().length < LIMITS.rosterSearchMinChars) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const result = await searchRosterCandidatesAction(slug, { groupId, q: next.trim() });
      if (id !== run.current) return;
      if (result.ok) setResults(result.data ?? []);
      else {
        setResults(null);
        toast.error(result.error);
      }
    } catch {
      if (id === run.current) toast.error(ACTION_COPY.generic);
    } finally {
      if (id === run.current) setSearching(false);
    }
  }

  async function add(personId: string) {
    if (pendingId) return;
    setPendingId(personId);
    try {
      const result = await addTeamMemberAction(slug, { groupId, personId });
      if (result.ok) {
        toast.success(TEAMS_COPY.page.personAdded);
        setQ("");
        setResults(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(ACTION_COPY.generic);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid="add-person">
      <Field id="roster-search" label={TEAMS_COPY.page.addPersonLabel}>
        <Input
          id="roster-search"
          type="search"
          value={q}
          onChange={(e) => void search(e.target.value)}
          placeholder={TEAMS_COPY.page.searchPlaceholder}
          autoComplete="off"
          className={INPUT_CLASSES}
        />
      </Field>
      <div aria-live="polite">
        {searching ? (
          <p className="text-sm text-muted-foreground">{NAV_COPY.loadingCandidates}</p>
        ) : results === null ? null : results.length === 0 ? (
          <p className="text-base text-muted-foreground">{NAV_COPY.searchNone}</p>
        ) : (
          <ul className="space-y-2" data-testid="roster-results">
            {results.map((candidate) => (
              <li key={candidate.personId} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-base font-medium [overflow-wrap:anywhere]">{candidate.displayName}</span>
                <Button type="button" className="min-h-11" disabled={pendingId !== null} onClick={() => void add(candidate.personId)}>
                  {TEAMS_COPY.page.addPerson}
                  <span className="sr-only"> {candidate.displayName}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function PeopleEditor({
  slug,
  groupId,
  teamName,
  positions,
  people,
  retired,
}: {
  slug: string;
  groupId: string;
  teamName: string;
  positions: TeamPosition[];
  people: TeamPerson[];
  retired: boolean;
}) {
  return (
    <section aria-labelledby="people-heading" className="space-y-3">
      <h2 id="people-heading" className="text-xl font-semibold">
        {TEAMS_COPY.page.peopleHeading}
      </h2>
      {!retired && <AddPerson slug={slug} groupId={groupId} />}
      {people.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-base text-muted-foreground">{MEMBER_COPY.team.empty}</p>
      )}
      <ul className="space-y-3" data-testid="roster-list">
        {people.map((person) => (
          <PersonCard
            key={person.groupMembershipId}
            slug={slug}
            groupId={groupId}
            teamName={teamName}
            person={person}
            positions={positions}
            retired={retired}
          />
        ))}
      </ul>
    </section>
  );
}
