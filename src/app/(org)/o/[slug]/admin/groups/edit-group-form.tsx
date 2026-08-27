"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UpdateGroupInput } from "@/lib/groups";
import { editGroupSchema, type EditGroupFormValues } from "./group-schema";
import { updateGroupAction } from "./actions";

/**
 * Edits an existing managed group's name/description/meeting schedule —
 * Flow 2. This form is only ever reached for a group `[groupId]/edit/
 * page.tsx` has already confirmed resolves through `getGroup()`'s `ok`
 * branch (never `invalid_target`) — a derived group's id never gets this
 * far, so this component itself carries no derived-group branch of its own
 * to omit or forget.
 */
export function EditGroupForm({
  slug,
  groupId,
  name,
  description,
  meetsWhen,
}: {
  slug: string;
  groupId: string;
  name: string;
  description: string | null;
  meetsWhen: string | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<EditGroupFormValues>({
    resolver: zodResolver(editGroupSchema),
    defaultValues: {
      name,
      description: description ?? "",
      meetsWhen: meetsWhen ?? "",
    },
  });

  const {
    register,
    formState: { errors },
  } = form;

  async function onSubmit(values: EditGroupFormValues) {
    const input: UpdateGroupInput = {
      groupId,
      name: values.name,
      description: values.description || undefined,
      meetsWhen: values.meetsWhen || undefined,
    };

    setSubmitting(true);
    const result = await updateGroupAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      toast.success("Group updated.");
      router.push(`/o/${slug}/admin/groups/${groupId}`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="edit-group-name">Name</Label>
        <Input
          id="edit-group-name"
          type="text"
          className="mt-1"
          aria-invalid={errors.name ? "true" : undefined}
          {...register("name")}
        />
        {errors.name && (
          <p className="mt-1 text-sm text-destructive">
            {errors.name.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="edit-group-description">Description (optional)</Label>
        <Input
          id="edit-group-description"
          type="text"
          className="mt-1"
          {...register("description")}
        />
      </div>

      <div>
        <Label htmlFor="edit-group-meets-when">
          When does it meet? (optional)
        </Label>
        <Input
          id="edit-group-meets-when"
          type="text"
          className="mt-1"
          {...register("meetsWhen")}
        />
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
