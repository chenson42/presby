"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { FormField, fieldA11y } from "@/components/giving/form-field";
import { COPY } from "@/lib/reimbursement/copy";
import { MAX_LENGTH } from "@/lib/reimbursement/limits";
import { cleanText, textLength } from "@/lib/reimbursement/text";
import { saveCategoryAction } from "../actions";

/**
 * `Add a category` (Copy C9): the field `Name` and a button with the same words as
 * the section action. A `useForm` root, so it renders `<HydrationGate>`
 * (DECISION-159). The name is judged after cleaning (1 to 60 characters); the
 * server's `Use 1 to 60 characters.` / `You already have a category with that
 * name.` lands under the box, and the name stays in the box when a save fails.
 * There is no success toast (Copy gives none): the new category appears in the
 * list and the box empties.
 */

interface Values {
  name: string;
}

export function AddCategoryForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const busy = useRef(false);
  const form = useForm<Values>({ defaultValues: { name: "" } });
  const {
    register,
    setError,
    clearErrors,
    getValues,
    reset,
    formState: { errors },
  } = form;

  async function submit() {
    if (busy.current) return;
    clearErrors();
    setBanner(null);
    const name = cleanText(getValues().name);
    if (name === null || textLength(name) > MAX_LENGTH.category) {
      setError("name", { type: "length", message: COPY.settings.categoryNameInvalid }, { shouldFocus: true });
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      const result = await saveCategoryAction(slug, { categoryId: null, name: getValues().name });
      if (result.ok) {
        reset({ name: "" });
        router.refresh();
        return;
      }
      if (result.kind === "two_factor_required" && result.redirectTo) {
        router.push(result.redirectTo);
        return;
      }
      const message = result.fieldErrors?.name;
      if (message) setError("name", { type: "server", message }, { shouldFocus: true });
      else setBanner(result.error);
    } catch {
      setBanner(COPY.form.saveFailed);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const error = errors.name?.message;
  return (
    <HydrationGate>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-3"
        data-testid="add-category-form"
      >
        {banner && (
          <p role="alert" className="rounded-lg border border-border bg-muted p-3 text-base">
            {banner}
          </p>
        )}
        <FormField id="category-name" label={COPY.settings.categoryName} error={error}>
          <Input
            className="min-h-11"
            autoComplete="off"
            {...fieldA11y("category-name", error)}
            {...register("name", { onChange: () => clearErrors("name") })}
          />
        </FormField>
        <Button type="submit" className="min-h-11" disabled={pending} data-testid="add-category-submit">
          {COPY.settings.addCategory}
        </Button>
      </form>
    </HydrationGate>
  );
}
