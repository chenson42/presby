"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useHydrated } from "@/components/shared/use-hydrated";
import {
  EDITABLE_ENGAGEMENTS,
  isEditableEngagement,
  type EditableEngagement,
  type Engagement,
} from "@/lib/membership-standing";
import { EngagementDialog } from "../../engagement-dialog";
import {
  ENGAGEMENT_CARD_COPY,
  ENGAGEMENT_LABELS,
  engagementDescription,
  engagementImpact,
} from "../../engagement-copy";
import { submitEngagementChange } from "../../submit-engagement";

/**
 * The Engagement card on the person's edit page (Increment 3a, Copy group A):
 * how the person is doing, for the administrator's own care, and the one place
 * a regular attender, an inactive person or a visitor is chosen. A plain
 * controlled `<select>` with no `useForm` (so `check:hydration-gate` does not
 * apply); every control is disabled until hydration (DECISION-159), which is
 * what stops a pre-hydration pick being shown but not held (F121/F124).
 *
 * `engagement` is the value the page rendered. It is what every write sends as
 * `expectedFrom` (Save and the nudge alike), so a change another administrator
 * made in the meantime answers "This changed while you were looking" instead of
 * being overwritten; the page remounts this card (`key={engagement}`) after a
 * refresh so the next attempt starts from the current value.
 *
 * Cases: a staff record has no engagement (a line, no control); an ended
 * membership says why it can't be changed; a person on the roll is not offered
 * Visitor and, if still marked Visitor, is nudged to Regular attender; a change
 * that moves someone into or out of the member directory asks first, through the
 * same dialog the list rows use, and every other change saves at once.
 */
export function EngagementCard({
  slug,
  personId,
  personName,
  engagement,
  currentRoll,
  ended,
  signInConnected,
  addressOnFile,
  selfConnectEnabled,
}: {
  slug: string;
  personId: string;
  personName: string;
  engagement: Engagement;
  /** `memberships.current_roll` as rendered. */
  currentRoll: string | null;
  /** The connection has ended: archived (restorable) or for another reason. */
  ended: "archived" | "other" | null;
  /** `people.user_id is not null`; null when the page could not read it. */
  signInConnected: boolean | null;
  addressOnFile: boolean | null;
  selfConnectEnabled: boolean | null;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const selectId = useId();
  const descriptionId = useId();
  const [selected, setSelected] = useState<Engagement>(engagement);
  const [pending, setPending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const onRoll = currentRoll !== null;

  if (engagement === "staff" || ended !== null) {
    return (
      <div data-testid="engagement-card" className="space-y-3">
        <h2 className="text-lg font-semibold">{ENGAGEMENT_CARD_COPY.heading}</h2>
        <p className="break-words text-sm text-muted-foreground">
          {engagement === "staff"
            ? ENGAGEMENT_CARD_COPY.staffRecord
            : ended === "archived"
              ? ENGAGEMENT_CARD_COPY.archived(personName)
              : ENGAGEMENT_CARD_COPY.otherEnded(personName)}
        </p>
      </div>
    );
  }

  const target: EditableEngagement | null = isEditableEngagement(selected) ? selected : null;
  const changed = target !== null && selected !== engagement;
  const impact = target
    ? engagementImpact({
        from: engagement,
        to: target,
        currentRoll,
        signInConnected,
        addressOnFile,
        selfConnectEnabled,
      })
    : null;
  const description = target ? engagementDescription(onRoll, target) : null;

  async function save() {
    if (!target || !impact) return;
    if (impact.opensDialog) {
      setDialogOpen(true);
      return;
    }
    setPending(true);
    const outcome = await submitEngagementChange({ slug, personId, personName, from: engagement, to: target });
    setPending(false);
    if (outcome.kind !== "thrown") router.refresh();
  }

  async function markRegular() {
    setPending(true);
    const outcome = await submitEngagementChange({
      slug,
      personId,
      personName,
      // The page showed Visitor: that is what the write is conditioned on.
      from: engagement,
      to: "regular",
    });
    setPending(false);
    if (outcome.kind !== "thrown") router.refresh();
  }

  return (
    <div data-testid="engagement-card" className="space-y-4">
      <h2 className="text-lg font-semibold">{ENGAGEMENT_CARD_COPY.heading}</h2>
      <p className="break-words text-sm text-muted-foreground">{ENGAGEMENT_CARD_COPY.helper}</p>

      {onRoll && engagement === "visitor" && (
        <div className="space-y-2 rounded-md border border-border p-3" data-testid="engagement-nudge">
          <p className="break-words text-sm">{ENGAGEMENT_CARD_COPY.nudge(personName)}</p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            disabled={!hydrated || pending}
            onClick={markRegular}
          >
            {ENGAGEMENT_CARD_COPY.nudgeButton}
          </Button>
        </div>
      )}

      <div>
        <Label htmlFor={selectId}>{ENGAGEMENT_CARD_COPY.selectLabel}</Label>
        <div className="relative mt-1">
          <select
            id={selectId}
            aria-label={ENGAGEMENT_CARD_COPY.selectAccessibleName(personName)}
            aria-describedby={description ? descriptionId : undefined}
            className="min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base disabled:cursor-not-allowed disabled:opacity-50"
            value={selected}
            disabled={!hydrated || pending}
            onChange={(e) => setSelected(e.target.value as Engagement)}
          >
            {EDITABLE_ENGAGEMENTS.map((value) => {
              // A person on the roll is never given Visitor; if that is their
              // stored value it is shown, as the current value, and not selectable.
              if (onRoll && value === "visitor") {
                return engagement === "visitor" ? (
                  <option key={value} value={value} disabled>
                    {ENGAGEMENT_CARD_COPY.currentOption(ENGAGEMENT_LABELS[value])}
                  </option>
                ) : null;
              }
              return (
                <option key={value} value={value}>
                  {ENGAGEMENT_LABELS[value]}
                </option>
              );
            })}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
        {description && (
          <p id={descriptionId} className="mt-2 break-words text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      <Button
        type="button"
        className="min-h-11 w-full sm:w-auto"
        disabled={!hydrated || pending || !changed}
        onClick={save}
      >
        {pending ? ENGAGEMENT_CARD_COPY.saving : ENGAGEMENT_CARD_COPY.save}
      </Button>

      {target && impact && (
        <EngagementDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          slug={slug}
          personId={personId}
          personName={personName}
          from={engagement}
          to={target}
          impact={impact}
        />
      )}
    </div>
  );
}
