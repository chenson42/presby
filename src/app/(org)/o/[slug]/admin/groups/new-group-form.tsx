"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CreateGroupInput, GroupFormOptions } from "@/lib/groups";
import {
  createGroupSchema,
  type CreateGroupFormValues,
} from "./group-schema";
import { createGroupAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function defaultValues(options: GroupFormOptions): CreateGroupFormValues {
  return {
    groupTypeId: options.groupTypes[0]?.id ?? "",
    name: "",
    description: "",
    meetsWhen: "",
  };
}

/**
 * Creates a new managed group — Flow 1. `react-hook-form` + `zod`, same
 * pattern `add-officer-term-form.tsx` establishes.
 *
 * THE GROUP-TYPE `<select>` ONLY EVER OFFERS `options.groupTypes`
 * (`getGroupFormOptions()`'s server-side manageable-subset filter) — this
 * form does its own client-side filtering of nothing; the server-side
 * filter IS the gate (Phase 3's Edge Cases & Risks, named load-bearing).
 * `createGroupAction` → `createGroup()` independently re-validates the
 * chosen id server-side, too — never trust this list alone.
 */
export function NewGroupForm({
  slug,
  options,
}: {
  slug: string;
  options: GroupFormOptions;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreateGroupFormValues>({
    resolver: zodResolver(createGroupSchema),
    defaultValues: defaultValues(options),
  });

  const {
    register,
    formState: { errors },
  } = form;

  if (options.groupTypes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No group types are available yet. Contact support before creating a
        committee or group.
      </p>
    );
  }

  async function onSubmit(values: CreateGroupFormValues) {
    const input: CreateGroupInput = {
      groupTypeId: values.groupTypeId,
      name: values.name,
      description: values.description || undefined,
      meetsWhen: values.meetsWhen || undefined,
    };

    setSubmitting(true);
    const result = await createGroupAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      toast.success("Group created.");
      router.push(`/o/${slug}/admin/groups/${result.data!.groupId}`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="new-group-type">Group type</Label>
        <div className="relative mt-1">
          <select
            id="new-group-type"
            className={SELECT_CLASSES}
            {...register("groupTypeId")}
          >
            {options.groupTypes.map((groupType) => (
              <option key={groupType.id} value={groupType.id}>
                {groupType.name}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
        {errors.groupTypeId && (
          <p className="mt-1 text-sm text-destructive">
            {errors.groupTypeId.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="new-group-name">Name</Label>
        <Input
          id="new-group-name"
          type="text"
          placeholder="e.g. Property Committee"
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
        <Label htmlFor="new-group-description">Description (optional)</Label>
        <Input
          id="new-group-description"
          type="text"
          className="mt-1"
          {...register("description")}
        />
      </div>

      <div>
        <Label htmlFor="new-group-meets-when">
          When does it meet? (optional)
        </Label>
        <Input
          id="new-group-meets-when"
          type="text"
          placeholder="e.g. Third Tuesday, 7pm"
          className="mt-1"
          {...register("meetsWhen")}
        />
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Creating…" : "Create group"}
      </Button>
    </form>
  );
}
