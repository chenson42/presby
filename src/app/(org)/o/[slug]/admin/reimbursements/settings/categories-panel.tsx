"use client";

import { useRef, useState } from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import { COPY } from "@/lib/reimbursement/copy";
import type { ReimbursementSettings } from "@/lib/reimbursement/detail-shape";
import { endCategoryAction } from "../actions";
import { AddCategoryForm } from "./add-category-form";
import { RenameCategoryDialog } from "./rename-category-dialog";

/**
 * `Categories` (Copy C9): the active categories with `Rename` and `Retire`, the
 * `Add a category` form, and the hint `Retired categories stay on old requests.`
 * Retire asks first in an `AlertDialog` (`COPY.settings.retireDialog`; Batch 6
 * amendment T3): it cannot be undone as the same row, because adding the name again
 * makes a new category. A retired category stays on every request that carries it.
 * Its trigger button reads "Retire <name>" to a screen reader through
 * `aria-labelledby`, with no string beyond Copy's. A category that is already
 * gone says so (`That category isn't in the list any more...`) and the page
 * re-reads. No success toast: the row leaves the list.
 */

type CategoryRow = ReimbursementSettings["categories"][number];

export function CategoriesPanel({ slug, categories }: { slug: string; categories: CategoryRow[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);

  async function retire(categoryId: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(categoryId);
    try {
      const result = await endCategoryAction(slug, { categoryId });
      if (result.ok) {
        router.refresh();
        return;
      }
      if (result.kind === "two_factor_required" && result.redirectTo) {
        router.push(result.redirectTo);
        return;
      }
      toast.error(result.error);
      router.refresh();
    } catch {
      toast.error(COPY.form.saveFailed);
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      {categories.length > 0 && (
        <ul className="space-y-3" data-testid="category-rows">
          {categories.map((category) => {
            const nameId = `category-${category.id}-name`;
            const retireId = `retire-${category.id}`;
            return (
              <li key={category.id} className="rounded-lg border border-border bg-card p-4" data-testid="category-row">
                <p id={nameId} className="text-base font-medium [overflow-wrap:anywhere]">
                  {category.name}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <RenameCategoryDialog slug={slug} categoryId={category.id} currentName={category.name} describedBy={nameId} />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        id={retireId}
                        aria-labelledby={`${retireId} ${nameId}`}
                        disabled={!hydrated || pending !== null}
                        data-testid="retire"
                      >
                        {COPY.settings.retire}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="[overflow-wrap:anywhere]">{COPY.settings.retireDialog.title(category.name)}</AlertDialogTitle>
                        <AlertDialogDescription>{COPY.settings.retireDialog.body}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="min-h-11">{COPY.settings.retireDialog.keep}</AlertDialogCancel>
                        <AlertDialogAction className="min-h-11" onClick={() => void retire(category.id)} data-testid="retire-confirm">
                          {COPY.settings.retireDialog.confirm}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">{COPY.settings.categoriesHint}</p>
      <AddCategoryForm slug={slug} />
    </div>
  );
}
