"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { FeatureCategoryEntry } from "@/lib/org-feature-categories";
import { toggleFeatureCategoryAction } from "./actions";

/**
 * The category picker (docs/work-log/2026-08-27-feature-categories.md, Phase
 * 3; DECISION-130) — structurally identical to `features-list.tsx`'s
 * `FeaturesList`/`FeatureToggleCard`, one level coarser: same Card/
 * CardContent shape, same `min-h-11` row, same optimistic-toggle-with-
 * revert-on-error, same toast pattern. Not a new visual pattern.
 *
 * Section intro copy is fresh-install-friendly, not error copy (Phase 1 Gap
 * 8) — `offeredCategories()` is never empty for any organization type (every
 * domain has at least one `orgTypeScope`-universal tile), so there is no
 * actual empty/zero-state to design for here, unlike `FeaturesList`'s own
 * dashed-border "No optional features yet" state below it on the same page.
 * The two states must read as visually and textually distinct, so a reader
 * scanning the page never mistakes "you haven't chosen a category yet"
 * (impossible — categories default on) for "no features exist yet"
 * (possible, and unrelated).
 */
export function FeatureCategoriesList({
  slug,
  categories,
}: {
  slug: string;
  categories: FeatureCategoryEntry[];
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Ministry areas</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which ministry areas apply to your organization. All are on
          by default — turn any off if it doesn&apos;t apply to your
          congregation.
        </p>
      </div>
      <ul className="space-y-3">
        {categories.map((category) => (
          <li key={category.category}>
            <FeatureCategoryCard slug={slug} category={category} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeatureCategoryCard({
  slug,
  category,
}: {
  slug: string;
  category: FeatureCategoryEntry;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(category.enabled);
  const [pending, setPending] = useState(false);

  async function handleChange(next: boolean) {
    setPending(true);
    const previous = enabled;
    setEnabled(next);
    const result = await toggleFeatureCategoryAction(slug, {
      category: category.category,
      enabled: next,
    });
    setPending(false);

    if (result.ok) {
      toast.success(
        next
          ? `${category.label} turned on.`
          : `${category.label} turned off.`,
      );
      // See features-list.tsx's identical comment — revalidatePath() alone
      // does not re-render an already-mounted page.
      router.refresh();
    } else {
      setEnabled(previous);
      toast.error(result.error);
    }
  }

  return (
    <Card>
      <CardContent className="flex min-h-11 items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">{category.label}</h3>
          {category.updatedAt && (
            <p className="mt-1 text-sm text-muted-foreground">
              Last changed <FormattedDate value={category.updatedAt} />
              {category.updatedByEmail ? ` by ${category.updatedByEmail}` : ""}
            </p>
          )}
        </div>
        <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
          <span className="sr-only">
            {category.label}, currently {enabled ? "on" : "off"}
          </span>
          <Switch
            checked={enabled}
            disabled={pending}
            onCheckedChange={handleChange}
          />
        </label>
      </CardContent>
    </Card>
  );
}
