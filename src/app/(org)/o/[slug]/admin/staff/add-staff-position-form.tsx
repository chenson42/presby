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
import { RequiredMark } from "@/components/shared/required-mark";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import type { StaffFormOptions, StartStaffPositionInput } from "@/lib/staff";
import type { CreatePersonInput } from "@/lib/people";
import {
  staffPositionSchema,
  newStaffPersonSchema,
  type StaffPositionFormValues,
  type NewStaffPersonFormValues,
} from "./position-schema";
import { createStaffPersonAction, startStaffPositionAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function defaultValues(
  people: StaffFormOptions["people"],
): StaffPositionFormValues {
  return {
    personId: people[0]?.personId ?? "",
    position: "",
    department: "",
    startsOn: "",
    minuteReference: "",
  };
}

const EMPTY_NEW_PERSON: NewStaffPersonFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
};

/**
 * Records a new staff position — Phase 3's Flow 1/2 combined into one form:
 * (a) attach to an existing person, via `getStaffFormOptions()`'s F21-shaped
 * CURRENT-members list (`options.people`, already scoped server-side — this
 * component does its OWN client-side text filter over that list, never a
 * live server search, per Phase 3's Component/Page Plan: "no live server
 * search needed — the list is bounded by org membership, same as
 * officers'"); or (b) the inline "this person doesn't exist yet" fallback,
 * a thin caller of `createStaffPersonAction()` (DECISION-128).
 *
 * `canCreatePeople` GATES THE FALLBACK VISIBLY, NOT JUST SILENTLY VIA THE
 * SERVER ACTION'S OWN GATE (architect's Phase 2/3 ruling 2 — `staff.manage`
 * alone must not reach the "add a new person" branch, which additionally
 * requires `people.manage`). A `staff.manage`-only holder never sees the
 * "Can't find them? Add a new person" affordance at all — `page.tsx` computes
 * `canCreatePeople` server-side via `hasPermission(..., "people.manage")`
 * and passes it down, matching `admin/members/page.tsx`'s own `canCreate`
 * shape for the identical permission key. `createStaffPersonAction()`'s own
 * server-side gate (inside `createPerson()`) is the actual enforcement —
 * this prop only decides whether the UI offers a path that would fail
 * anyway, per the design's own "name the gap plainly" instruction.
 *
 * NO BROADER, CROSS-ORG DUPLICATE-MATCH STEP (`matchPerson()`/
 * `presby_match_person()`) IN THIS FORM — a deliberate reading of Phase 3's
 * Component/Page Plan, which describes exactly two states (the bounded
 * current-members picker, and a direct "add a new person" fallback) and
 * names no intermediate broader-search step, unlike `admin/members/new`'s
 * own dedup-search wizard. `src/lib/staff.ts`'s own header flagged this as
 * an open plumbing question for this slice to resolve; resolved here in
 * favor of the design text's literal, simpler two-state shape rather than
 * inventing a third state the design never asked for. This does mean a
 * staff hire who already exists as a person at ANOTHER organization (or as
 * a not-yet-a-member contact somehow missed by the current-members list)
 * gets a new, unlinked `people` row rather than being matched — a real,
 * named UX tradeoff for Phase 6 to weigh, not an oversight.
 *
 * TWO SEPARATE `useForm()` INSTANCES, ONE `<form>` ELEMENT. Nesting a second
 * `<form>` inside the position form for the "add a new person" fallback
 * would be invalid HTML — the fallback's own fields are a second
 * `react-hook-form` instance (`personForm`) whose submit is triggered
 * manually (`personForm.handleSubmit(...)()`) from a `type="button"` button,
 * never rendered inside its own `<form>` tag.
 */
export function AddStaffPositionForm({
  slug,
  options,
  canCreatePeople,
}: {
  slug: string;
  options: StaffFormOptions;
  canCreatePeople: boolean;
}) {
  const router = useRouter();
  const [people, setPeople] = useState(options.people);
  const [submitting, setSubmitting] = useState(false);
  const [showNewPersonForm, setShowNewPersonForm] = useState(
    people.length === 0 && canCreatePeople,
  );
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [personQuery, setPersonQuery] = useState("");

  const form = useForm<StaffPositionFormValues>({
    resolver: zodResolver(staffPositionSchema),
    defaultValues: defaultValues(people),
  });
  const {
    register,
    formState: { errors, isDirty },
    setValue,
  } = form;

  const personForm = useForm<NewStaffPersonFormValues>({
    resolver: zodResolver(newStaffPersonSchema),
    defaultValues: EMPTY_NEW_PERSON,
  });

  // H3 (docs/reviews/2026-08-26-portal-ux.md) — same guard shape every other
  // form in this pipeline uses. `personForm`'s own dirtiness is deliberately
  // NOT included: it is a short, low-cost fallback sub-form, not the
  // position record itself, and a half-typed new-person name is not worth
  // an extra discard prompt on top of the position form's own.
  const { discardOpen, setDiscardOpen, confirmDiscard } =
    useUnsavedChangesGuard(isDirty);

  if (people.length === 0 && !canCreatePeople) {
    return (
      <p className="text-sm text-muted-foreground">
        Nobody has a current membership at this organization yet, and you
        don&apos;t have permission to add a new person. Ask someone who
        manages People to add one first.
      </p>
    );
  }

  const filteredPeople = personQuery.trim()
    ? people.filter((person) =>
        person.displayName
          .toLowerCase()
          .includes(personQuery.trim().toLowerCase()),
      )
    : people;

  async function handleCreatePerson(values: NewStaffPersonFormValues) {
    const input: CreatePersonInput = {
      identity: {
        mode: "new",
        firstName: values.firstName,
        lastName: values.lastName,
      },
      contact: {
        email: values.email || undefined,
        phone: values.phone || undefined,
      },
      household: { mode: "none" },
      // Overwritten server-side regardless (createStaffPersonAction never
      // trusts this) — set explicitly here so this input is self-describing
      // rather than relying on the server's override alone.
      rollAction: { kind: "none" },
    };

    setCreatingPerson(true);
    const result = await createStaffPersonAction(slug, input);
    setCreatingPerson(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    const displayName = `${values.firstName} ${values.lastName}`;
    setPeople((prev) =>
      [...prev, { personId: result.data!.personId, displayName }].sort(
        (a, b) => a.displayName.localeCompare(b.displayName),
      ),
    );
    setValue("personId", result.data!.personId, { shouldDirty: true });
    setShowNewPersonForm(false);
    personForm.reset(EMPTY_NEW_PERSON);
    toast.success(`${displayName} added — now record their position below.`);
  }

  async function onSubmit(values: StaffPositionFormValues) {
    const input: StartStaffPositionInput = {
      personId: values.personId,
      position: values.position,
      department: values.department || undefined,
      startsOn: values.startsOn,
      minuteReference: values.minuteReference || undefined,
    };

    setSubmitting(true);
    const result = await startStaffPositionAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      toast.success("Staff position recorded.");
      form.reset(defaultValues(people));
      // `startStaffPositionAction` already calls `revalidatePath()`
      // server-side — `router.refresh()` is what actually re-renders an
      // already-mounted page, same fix `add-officer-term-form.tsx`'s
      // identical comment documents.
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      {people.length > 0 && !showNewPersonForm && (
        <div className="space-y-2">
          <Label htmlFor="staff-position-person-query">
            Find person
          </Label>
          <Input
            id="staff-position-person-query"
            type="text"
            placeholder="Type a name to filter the list…"
            value={personQuery}
            onChange={(e) => setPersonQuery(e.target.value)}
          />

          <Label htmlFor="staff-position-person">
            Person
            <RequiredMark />
          </Label>
          <div className="relative">
            <select
              id="staff-position-person"
              className={SELECT_CLASSES}
              aria-required="true"
              {...register("personId")}
            >
              {filteredPeople.length === 0 ? (
                <option value="">No matches</option>
              ) : (
                filteredPeople.map((person) => (
                  <option key={person.personId} value={person.personId}>
                    {person.displayName}
                  </option>
                ))
              )}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
          {errors.personId && (
            <p className="text-sm text-destructive">
              {errors.personId.message}
            </p>
          )}

          {canCreatePeople ? (
            <button
              type="button"
              onClick={() => setShowNewPersonForm(true)}
              className="min-h-11 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Can&apos;t find them? Add a new person
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only current members show here. Ask someone who manages People
              to add someone new.
            </p>
          )}
        </div>
      )}

      {showNewPersonForm && canCreatePeople && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <p className="text-sm font-medium">Add a new person</p>
          <p className="text-sm text-muted-foreground">
            This creates a real person record, anchored here as a known
            contact — not a member of the roll. Someone who manages People
            can complete the fuller record later if needed.
          </p>

          <div>
            <Label htmlFor="staff-new-person-first-name">
              First name
              <RequiredMark />
            </Label>
            <Input
              id="staff-new-person-first-name"
              type="text"
              aria-required="true"
              className="mt-1"
              {...personForm.register("firstName")}
            />
            {personForm.formState.errors.firstName && (
              <p className="mt-1 text-sm text-destructive">
                {personForm.formState.errors.firstName.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="staff-new-person-last-name">
              Last name
              <RequiredMark />
            </Label>
            <Input
              id="staff-new-person-last-name"
              type="text"
              aria-required="true"
              className="mt-1"
              {...personForm.register("lastName")}
            />
            {personForm.formState.errors.lastName && (
              <p className="mt-1 text-sm text-destructive">
                {personForm.formState.errors.lastName.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="staff-new-person-email">Email (optional)</Label>
            <Input
              id="staff-new-person-email"
              type="email"
              className="mt-1"
              {...personForm.register("email")}
            />
          </div>

          <div>
            <Label htmlFor="staff-new-person-phone">Phone (optional)</Label>
            <Input
              id="staff-new-person-phone"
              type="tel"
              className="mt-1"
              {...personForm.register("phone")}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={creatingPerson}
              className="min-h-11"
              onClick={personForm.handleSubmit(handleCreatePerson)}
            >
              {creatingPerson ? "Adding…" : "Add person"}
            </Button>
            {people.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  setShowNewPersonForm(false);
                  personForm.reset(EMPTY_NEW_PERSON);
                }}
              >
                Choose an existing person instead
              </Button>
            )}
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="staff-position-position">
          Position
          <RequiredMark />
        </Label>
        <Input
          id="staff-position-position"
          type="text"
          placeholder="e.g. Church Secretary"
          aria-invalid={errors.position ? "true" : undefined}
          aria-required="true"
          className="mt-1"
          {...register("position")}
        />
        {errors.position && (
          <p className="mt-1 text-sm text-destructive">
            {errors.position.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="staff-position-department">
          Department (optional)
        </Label>
        <Input
          id="staff-position-department"
          type="text"
          placeholder="e.g. Facilities"
          className="mt-1"
          {...register("department")}
        />
      </div>

      <div>
        <Label htmlFor="staff-position-starts-on">
          Start date
          <RequiredMark />
        </Label>
        <Input
          id="staff-position-starts-on"
          type="date"
          aria-invalid={errors.startsOn ? "true" : undefined}
          aria-describedby={
            errors.startsOn ? "staff-position-starts-on-error" : undefined
          }
          aria-required="true"
          className="mt-1"
          {...register("startsOn")}
        />
        {errors.startsOn && (
          <p
            id="staff-position-starts-on-error"
            className="mt-1 text-sm text-destructive"
          >
            {errors.startsOn.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="staff-position-minute-reference">
          Minute reference (optional)
        </Label>
        <Input
          id="staff-position-minute-reference"
          type="text"
          placeholder="e.g. Session minutes, 12 Jan 2026"
          className="mt-1"
          {...register("minuteReference")}
        />
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Recording…" : "Add staff position"}
      </Button>
      <UnsavedChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirmDiscard={confirmDiscard}
      />
    </form>
  );
}
