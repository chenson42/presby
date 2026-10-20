"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { FeatureToggleEntry } from "@/lib/org-features";
import type { OffWarning } from "@/lib/org-feature-warnings";
import { toggleFeatureAction } from "./actions";

/**
 * One card per catalog entry (`ORG_FEATURE_CATALOG`, currently one row —
 * `org_portal.members_create`). Each card is self-contained (its own pending
 * state) so toggling one feature never disables the others while its
 * request is in flight.
 *
 * `Switch` alone is ~18x32px, under the 44px touch-target floor — the whole
 * row (label + switch) is wrapped in a `min-h-11` flex row so the effective
 * tap target meets WCAG 2.5.5, same discipline `grant-role-form.tsx`'s radio
 * labels already establish for a Radix control smaller than the floor.
 */
export function FeaturesList({
  slug,
  toggles,
  offWarnings = {},
}: {
  slug: string;
  toggles: FeatureToggleEntry[];
  /**
   * Per-feature "turning this OFF has a consequence" dialogs, keyed by feature
   * key (docs/work-log/2026-10-15-online-giving.md; `loadOffWarnings`). A
   * toggle with an entry asks in an AlertDialog before it switches off.
   */
  offWarnings?: Record<string, OffWarning>;
}) {
  if (toggles.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No optional features yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          New portal features will appear here as they ship.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {toggles.map((toggle) => (
        <li key={toggle.key}>
          <FeatureToggleCard slug={slug} toggle={toggle} offWarning={offWarnings[toggle.key]} />
        </li>
      ))}
    </ul>
  );
}

function FeatureToggleCard({
  slug,
  toggle,
  offWarning,
}: {
  slug: string;
  toggle: FeatureToggleEntry;
  offWarning?: OffWarning;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(toggle.enabled);
  const [pending, setPending] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);

  // Category-off UI state (docs/work-log/2026-08-27-feature-categories.md,
  // Phase 1 Gap 4; DECISION-130): a toggle whose category is off renders
  // disabled + explained, never silently inert. The switch still shows the
  // toggle's own NOMINAL `enabled` state underneath (never reset — Gap 5,
  // preserve-not-reset), so turning the category back on restores the
  // per-feature choice exactly where it was left, with no code needed to
  // "restore" it — organization_feature_toggles was never touched while the
  // category was off.
  const categoryOff = !toggle.categoryEnabled;

  async function handleChange(next: boolean) {
    setPending(true);
    const previous = enabled;
    setEnabled(next);
    const result = await toggleFeatureAction(slug, {
      key: toggle.key,
      enabled: next,
    });
    setPending(false);

    if (result.ok) {
      toast.success(
        next ? `${toggle.name} turned on.` : `${toggle.name} turned off.`,
      );
      // See admin/roles/grant-role-form.tsx's identical comment —
      // `revalidatePath()` alone does not re-render an already-mounted page.
      router.refresh();
    } else {
      setEnabled(previous);
      toast.error(result.error);
    }
  }

  return (
    <Card className={categoryOff ? "opacity-70" : undefined}>
      <CardContent className="flex min-h-11 items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">{toggle.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {toggle.description}
          </p>
          {categoryOff && (
            <p className="mt-1 text-sm text-muted-foreground">
              Turn on {toggle.categoryLabel} above to enable this.
            </p>
          )}
          {toggle.updatedAt && (
            <p className="mt-1 text-sm text-muted-foreground">
              Last changed <FormattedDate value={toggle.updatedAt} />
              {toggle.updatedByEmail ? ` by ${toggle.updatedByEmail}` : ""}
            </p>
          )}
        </div>
        <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
          <span className="sr-only">
            {toggle.name}, currently {enabled ? "on" : "off"}
            {categoryOff
              ? ` — turn on ${toggle.categoryLabel} above to enable this`
              : ""}
          </span>
          <Switch
            checked={enabled}
            disabled={pending || categoryOff}
            onCheckedChange={(next) => {
              // Turning OFF a feature that has a registered consequence asks first.
              if (!next && offWarning) setWarnOpen(true);
              else void handleChange(next);
            }}
          />
        </label>
      </CardContent>
      {offWarning && (
        <AlertDialog open={warnOpen} onOpenChange={setWarnOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Turn off {toggle.name}?</AlertDialogTitle>
              <AlertDialogDescription>{offWarning.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it on</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleChange(false)}>
                Turn it off
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}
