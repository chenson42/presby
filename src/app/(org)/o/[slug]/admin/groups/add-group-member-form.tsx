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
import type { AddGroupMemberInput } from "@/lib/groups";
import { GROUP_ROLE_LABELS, GROUP_ROLES } from "./group-type-labels";
import {
  addGroupMemberSchema,
  type AddGroupMemberFormValues,
} from "./group-schema";
import { addGroupMemberAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultValues(
  people: Array<{ personId: string; displayName: string }>,
): AddGroupMemberFormValues {
  return {
    personId: people[0]?.personId ?? "",
    groupRole: "member",
    startsOn: today(),
  };
}

/**
 * Adds a person to a group's roster — Flow 3. `groupName` is passed through
 * only for the success toast; the group itself is fixed by `groupId` (this
 * form always lives on one group's own detail page, unlike
 * `add-officer-term-form.tsx`, which lets the caller pick the office).
 *
 * `addGroupMemberAction`'s `overlap` copy (already composed server-side,
 * naming both the person and the group) surfaces via `toast.error()`
 * verbatim, same discipline `add-officer-term-form.tsx`'s header documents
 * for the exclusion-violation case.
 */
export function AddGroupMemberForm({
  slug,
  groupId,
  people,
}: {
  slug: string;
  groupId: string;
  people: Array<{ personId: string; displayName: string }>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<AddGroupMemberFormValues>({
    resolver: zodResolver(addGroupMemberSchema),
    defaultValues: defaultValues(people),
  });

  const {
    register,
    formState: { errors },
  } = form;

  if (people.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nobody has a current membership at this organization yet. Add a
        member first, then come back to add them to this group.
      </p>
    );
  }

  async function onSubmit(values: AddGroupMemberFormValues) {
    const input: AddGroupMemberInput = {
      groupId,
      personId: values.personId,
      groupRole: values.groupRole,
      startsOn: values.startsOn,
    };

    setSubmitting(true);
    const result = await addGroupMemberAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      toast.success("Member added.");
      form.reset(defaultValues(people));
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="add-group-member-person">Person</Label>
        <div className="relative mt-1">
          <select
            id="add-group-member-person"
            className={SELECT_CLASSES}
            {...register("personId")}
          >
            {people.map((person) => (
              <option key={person.personId} value={person.personId}>
                {person.displayName}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
        {errors.personId && (
          <p className="mt-1 text-sm text-destructive">
            {errors.personId.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="add-group-member-role">Role</Label>
        <div className="relative mt-1">
          <select
            id="add-group-member-role"
            className={SELECT_CLASSES}
            {...register("groupRole")}
          >
            {GROUP_ROLES.map((value) => (
              <option key={value} value={value}>
                {GROUP_ROLE_LABELS[value]}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          This is descriptive only — it does not grant software access.
        </p>
      </div>

      <div>
        <Label htmlFor="add-group-member-starts-on">Start date</Label>
        <Input
          id="add-group-member-starts-on"
          type="date"
          className="mt-1"
          aria-invalid={errors.startsOn ? "true" : undefined}
          {...register("startsOn")}
        />
        {errors.startsOn && (
          <p className="mt-1 text-sm text-destructive">
            {errors.startsOn.message}
          </p>
        )}
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Adding…" : "Add member"}
      </Button>
    </form>
  );
}
