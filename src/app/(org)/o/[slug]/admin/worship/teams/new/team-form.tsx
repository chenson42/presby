"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describedBy, Field, INPUT_CLASSES, SELECT_CLASSES, SelectBox } from "@/components/worship/form-bits";
import { ACTION_COPY, NAV_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import { STARTER_SETS, type StarterKey } from "@/lib/worship/starters";
import { TEAM_KINDS, type TeamKind } from "@/lib/worship/vocab";
import { createTeamAction } from "../../actions";

/** "New team" (Copy G3): name, kind, and a ready-made set of positions (or none). The server validates; its sentence is shown inline. */
export function TeamForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TeamKind>("team");
  const [starter, setStarter] = useState<StarterKey>("praise_band");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await createTeamAction(slug, { name, kind, starter });
      if (result.ok && result.data) {
        toast.success(TEAMS_COPY.form.toast);
        router.push(`/o/${slug}/admin/worship/teams/${result.data.groupId}`);
      } else if (!result.ok) {
        setError(result.error);
      }
    } catch {
      setError(ACTION_COPY.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <HydrationGate>
      <form onSubmit={onSubmit} className="space-y-4" data-testid="team-form">
        <Field id="team-name" label={TEAMS_COPY.form.nameLabel} error={error}>
          <Input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="off"
            className={INPUT_CLASSES}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={describedBy("team-name", { error: Boolean(error) })}
          />
        </Field>
        <Field id="team-kind" label={TEAMS_COPY.form.kindLabel}>
          <SelectBox>
            <select id="team-kind" className={SELECT_CLASSES} value={kind} onChange={(e) => setKind(e.target.value as TeamKind)}>
              {TEAM_KINDS.map((value) => (
                <option key={value} value={value}>
                  {TEAMS_COPY.form.kindOptions[value]}
                </option>
              ))}
            </select>
          </SelectBox>
        </Field>
        <Field id="team-starter" label={TEAMS_COPY.form.startWithLabel}>
          <SelectBox>
            <select id="team-starter" className={SELECT_CLASSES} value={starter} onChange={(e) => setStarter(e.target.value as StarterKey)}>
              {STARTER_SETS.map((set) => (
                <option key={set.key} value={set.key}>
                  {set.label}
                </option>
              ))}
            </select>
          </SelectBox>
        </Field>
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={pending}>
          {pending ? NAV_COPY.saving : TEAMS_COPY.form.submit}
        </Button>
      </form>
    </HydrationGate>
  );
}
