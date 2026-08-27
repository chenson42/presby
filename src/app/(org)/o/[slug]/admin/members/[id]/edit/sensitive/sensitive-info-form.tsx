"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import type { SensitiveInfoForEdit } from "@/lib/person-sensitive";
import {
  addPersonNoteAction,
  setPersonDemographicsAction,
  setPersonMedicalAction,
  setPersonDisabilitiesAction,
} from "./actions";

// H1 (docs/reviews/2026-08-26-portal-ux.md): `pr-8` reserves room for the
// manual chevron every select on this page now renders — see
// `directory-grid.tsx`'s status select for the reference implementation.
const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const NOTE_TYPES = [
  { value: "general", label: "General" },
  { value: "pastoral_care", label: "Pastoral care" },
  { value: "visit", label: "Visit" },
  { value: "prayer", label: "Prayer" },
  { value: "admin", label: "Admin" },
] as const;

const VISIBILITIES = [
  { value: "staff", label: "Staff" },
  { value: "pastoral", label: "Pastoral" },
  { value: "clergy_only", label: "Clergy only" },
] as const;

const RACIAL_ETHNIC_OPTIONS = [
  "asian",
  "african",
  "african_american",
  "black",
  "hispanic",
  "middle_eastern",
  "native_american",
  "white",
  "other",
] as const;

const DISABILITY_CATEGORIES = [
  { value: "hearing", label: "Hearing" },
  { value: "mobility", label: "Mobility" },
  { value: "sight", label: "Sight" },
  { value: "other", label: "Other" },
] as const;

const BODY_MAX_LENGTH = 4000;
const FIELD_MAX_LENGTH = 2000;

/**
 * One form PER granted section (notes list + add-note form; demographics;
 * medical; disabilities), each with its own submit button and its own
 * `useState(submitting)` — mirrors `EditPersonForm`'s controlled-input shape,
 * not one giant cross-section submit (Phase 3's component plan).
 *
 * A section renders ONLY when `data.grants.<key>` is true — absence, not a
 * disabled control, matching Phase 1's requirement for the parent link.
 */
export function SensitiveInfoForm({
  slug,
  personId,
  data,
}: {
  slug: string;
  personId: string;
  data: SensitiveInfoForEdit;
}) {
  // H3 (docs/reviews/2026-08-26-portal-ux.md) — four independent sub-forms,
  // each with its own submit button, share ONE guard: a change in ANY
  // section marks the whole page dirty, and each section clears its own key
  // once ITS save succeeds (a saved demographics section doesn't force a
  // still-unsaved pastoral note to stop guarding the page).
  const [sectionDirty, setSectionDirty] = useState<Record<string, boolean>>(
    {},
  );
  const isDirty = Object.values(sectionDirty).some(Boolean);
  const { discardOpen, setDiscardOpen, confirmDiscard } =
    useUnsavedChangesGuard(isDirty);

  const handleSectionDirtyChange = useCallback(
    (key: string, dirty: boolean) => {
      setSectionDirty((prev) =>
        prev[key] === dirty ? prev : { ...prev, [key]: dirty },
      );
    },
    [],
  );

  return (
    <div className="space-y-10">
      <Badge variant="outline" className="gap-1.5 py-1">
        <Lock className="size-3" aria-hidden />
        Restricted — visible only to the offices holding each section&apos;s
        permission
      </Badge>
      {data.grants.pastoralNotes && (
        <PastoralNotesSection
          slug={slug}
          personId={personId}
          notes={data.notes ?? []}
          onDirtyChange={(dirty) =>
            handleSectionDirtyChange("pastoralNotes", dirty)
          }
        />
      )}
      {data.grants.demographics && (
        <DemographicsSection
          slug={slug}
          personId={personId}
          initial={data.demographics ?? null}
          onDirtyChange={(dirty) =>
            handleSectionDirtyChange("demographics", dirty)
          }
        />
      )}
      {data.grants.medical && (
        <MedicalSection
          slug={slug}
          personId={personId}
          initial={data.medical ?? null}
          onDirtyChange={(dirty) => handleSectionDirtyChange("medical", dirty)}
        />
      )}
      {data.grants.disabilities && data.disabilityTrackingEnabled && (
        <DisabilitiesSection
          slug={slug}
          personId={personId}
          initial={data.disabilities ?? []}
          onDirtyChange={(dirty) =>
            handleSectionDirtyChange("disabilities", dirty)
          }
        />
      )}
      <UnsavedChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirmDiscard={confirmDiscard}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pastoral notes — insert-only: a list, plus an add-note form
// ---------------------------------------------------------------------------

function PastoralNotesSection({
  slug,
  personId,
  notes,
  onDirtyChange,
}: {
  slug: string;
  personId: string;
  notes: NonNullable<SensitiveInfoForEdit["notes"]>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [noteType, setNoteType] = useState<(typeof NOTE_TYPES)[number]["value"]>(
    "general",
  );
  const [visibility, setVisibility] =
    useState<(typeof VISIBILITIES)[number]["value"]>("staff");
  const [body, setBody] = useState("");
  const [occurredOn, setOccurredOn] = useState("");

  // A blank draft (nothing typed yet) is never "dirty" — noteType/visibility
  // stay at their sensible defaults until there's a body to go with them.
  const isDirty = body.trim() !== "" || occurredOn !== "";
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) {
      toast.error("Enter a note before saving.");
      return;
    }

    setSubmitting(true);
    const result = await addPersonNoteAction(slug, personId, {
      noteType,
      visibility,
      body,
      occurredOn: occurredOn || undefined,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success("Note added.");
      setBody("");
      setOccurredOn("");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Pastoral care notes</h2>

      {notes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm font-medium">No notes recorded yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the first pastoral care note below.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {NOTE_TYPES.find((n) => n.value === note.noteType)?.label ??
                    note.noteType}
                </span>
                <span>·</span>
                <span>
                  {VISIBILITIES.find((v) => v.value === note.visibility)
                    ?.label ?? note.visibility}
                </span>
                {note.occurredOn && (
                  <>
                    <span>·</span>
                    <span>{note.occurredOn}</span>
                  </>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="space-y-3 border-t border-border pt-4">
        <div>
          <Label htmlFor="note-type">Note type</Label>
          <div className="relative mt-1">
            <select
              id="note-type"
              className={SELECT_CLASSES}
              value={noteType}
              onChange={(e) =>
                setNoteType(
                  e.target.value as (typeof NOTE_TYPES)[number]["value"],
                )
              }
            >
              {NOTE_TYPES.map((n) => (
                <option key={n.value} value={n.value}>
                  {n.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>

        <div>
          <Label htmlFor="note-visibility">Visibility</Label>
          <div className="relative mt-1">
            <select
              id="note-visibility"
              className={SELECT_CLASSES}
              value={visibility}
              onChange={(e) =>
                setVisibility(
                  e.target.value as (typeof VISIBILITIES)[number]["value"],
                )
              }
            >
              {VISIBILITIES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>

        <div>
          <Label htmlFor="note-occurred-on">Date (optional)</Label>
          <Input
            id="note-occurred-on"
            type="date"
            className="mt-1"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="note-body">Note</Label>
          <Textarea
            id="note-body"
            className="mt-1"
            rows={4}
            maxLength={BODY_MAX_LENGTH}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <Button type="submit" disabled={submitting} className="min-h-11">
          {submitting ? "Adding…" : "Add note"}
        </Button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Demographics — upsert
// ---------------------------------------------------------------------------

function DemographicsSection({
  slug,
  personId,
  initial,
  onDirtyChange,
}: {
  slug: string;
  personId: string;
  initial: NonNullable<SensitiveInfoForEdit["demographics"]> | null;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [racialEthnic, setRacialEthnic] = useState<string[]>(
    initial?.racialEthnic ?? [],
  );
  const [source, setSource] = useState<"self" | "staff">(
    (initial?.source as "self" | "staff") ?? "self",
  );
  const [racialEthnicFilter, setRacialEthnicFilter] = useState("");

  // A "saved snapshot" in STATE, not a ref, and not a straight comparison
  // against `initial` — this section's own successful save doesn't re-fetch
  // new `initial` props (only `router.refresh()`, which re-renders the
  // SERVER tree but not this already-mounted client instance's props), so
  // the dirty check has to move its own goalposts forward on save rather
  // than rely on a prop that never changes underneath it. State, not a ref,
  // because the comparison below reads it during render — reading (or
  // writing) a ref's `.current` during render is impure.
  const [saved, setSaved] = useState({
    gender: initial?.gender ?? "",
    racialEthnic: initial?.racialEthnic ?? [],
    source: (initial?.source as "self" | "staff") ?? "self",
  });
  const isDirty =
    gender !== saved.gender ||
    source !== saved.source ||
    racialEthnic.length !== saved.racialEthnic.length ||
    racialEthnic.some((v) => !saved.racialEthnic.includes(v));
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const filteredRacialEthnicOptions = RACIAL_ETHNIC_OPTIONS.filter((option) =>
    option
      .replaceAll("_", " ")
      .toLowerCase()
      .includes(racialEthnicFilter.trim().toLowerCase()),
  );

  function toggleRacialEthnic(value: string) {
    setRacialEthnic((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const result = await setPersonDemographicsAction(slug, personId, {
      gender: gender || null,
      racialEthnic: racialEthnic.length > 0 ? racialEthnic : null,
      source,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success("Demographics saved.");
      setSaved({ gender, racialEthnic: [...racialEthnic], source });
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Demographics</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="demographics-gender">Gender (optional)</Label>
          <Input
            id="demographics-gender"
            className="mt-1"
            maxLength={FIELD_MAX_LENGTH}
            value={gender}
            onChange={(e) => setGender(e.target.value)}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Racial / ethnic (optional, select all that apply)
          </legend>
          {/* M4 (docs/reviews/2026-08-26-portal-ux.md): 9 options crosses
              ui-standards.md § Multi-select's ~6-option filter threshold. */}
          <Label htmlFor="demographics-racial-ethnic-filter" className="sr-only">
            Filter racial / ethnic options
          </Label>
          <Input
            id="demographics-racial-ethnic-filter"
            type="text"
            placeholder="Filter options…"
            value={racialEthnicFilter}
            onChange={(e) => setRacialEthnicFilter(e.target.value)}
          />
          <div className="flex flex-col gap-2">
            {filteredRacialEthnicOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No options match &quot;{racialEthnicFilter}&quot;.
              </p>
            ) : (
              filteredRacialEthnicOptions.map((option) => (
                <label
                  key={option}
                  className="inline-flex min-h-11 items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={racialEthnic.includes(option)}
                    onChange={() => toggleRacialEthnic(option)}
                    className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                  {option.replaceAll("_", " ")}
                </label>
              ))
            )}
          </div>
        </fieldset>

        <div>
          <Label htmlFor="demographics-source">Source</Label>
          <div className="relative mt-1">
            <select
              id="demographics-source"
              className={SELECT_CLASSES}
              value={source}
              onChange={(e) => setSource(e.target.value as "self" | "staff")}
            >
              <option value="self">Self-reported</option>
              <option value="staff">Staff-observed</option>
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>

        <Button type="submit" disabled={submitting} className="min-h-11">
          {submitting ? "Saving…" : "Save demographics"}
        </Button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Medical — upsert
// ---------------------------------------------------------------------------

function MedicalSection({
  slug,
  personId,
  initial,
  onDirtyChange,
}: {
  slug: string;
  personId: string;
  initial: NonNullable<SensitiveInfoForEdit["medical"]> | null;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [allergies, setAllergies] = useState(initial?.allergies ?? "");
  const [medicalNotes, setMedicalNotes] = useState(initial?.medicalNotes ?? "");
  const [medications, setMedications] = useState(initial?.medications ?? "");
  const [authorizedPickup, setAuthorizedPickup] = useState(
    initial?.authorizedPickup ?? "",
  );

  // Same "saved snapshot" reasoning as `DemographicsSection` above (state,
  // not a ref — the comparison below reads it during render).
  const [saved, setSaved] = useState({
    allergies: initial?.allergies ?? "",
    medicalNotes: initial?.medicalNotes ?? "",
    medications: initial?.medications ?? "",
    authorizedPickup: initial?.authorizedPickup ?? "",
  });
  const isDirty =
    allergies !== saved.allergies ||
    medicalNotes !== saved.medicalNotes ||
    medications !== saved.medications ||
    authorizedPickup !== saved.authorizedPickup;
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const result = await setPersonMedicalAction(slug, personId, {
      allergies: allergies || null,
      medicalNotes: medicalNotes || null,
      medications: medications || null,
      authorizedPickup: authorizedPickup || null,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success("Medical information saved.");
      setSaved({
        allergies,
        medicalNotes,
        medications,
        authorizedPickup,
      });
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Medical / children&apos;s check-in</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="medical-allergies">Allergies (optional)</Label>
          <Textarea
            id="medical-allergies"
            className="mt-1"
            rows={2}
            maxLength={BODY_MAX_LENGTH}
            value={allergies}
            onChange={(e) => setAllergies(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="medical-medications">Medications (optional)</Label>
          <Textarea
            id="medical-medications"
            className="mt-1"
            rows={2}
            maxLength={BODY_MAX_LENGTH}
            value={medications}
            onChange={(e) => setMedications(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="medical-authorized-pickup">
            Authorized pickup (optional)
          </Label>
          <Textarea
            id="medical-authorized-pickup"
            className="mt-1"
            rows={2}
            maxLength={BODY_MAX_LENGTH}
            value={authorizedPickup}
            onChange={(e) => setAuthorizedPickup(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="medical-notes">Other medical notes (optional)</Label>
          <Textarea
            id="medical-notes"
            className="mt-1"
            rows={3}
            maxLength={BODY_MAX_LENGTH}
            value={medicalNotes}
            onChange={(e) => setMedicalNotes(e.target.value)}
          />
        </div>

        <Button type="submit" disabled={submitting} className="min-h-11">
          {submitting ? "Saving…" : "Save medical information"}
        </Button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Disabilities — set-replace
// ---------------------------------------------------------------------------

function DisabilitiesSection({
  slug,
  personId,
  initial,
  onDirtyChange,
}: {
  slug: string;
  personId: string;
  initial: string[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [categories, setCategories] = useState<string[]>(initial);

  // Same "saved snapshot" reasoning as the two sections above (state, not a
  // ref).
  const [saved, setSaved] = useState<string[]>(initial);
  const isDirty =
    categories.length !== saved.length ||
    categories.some((c) => !saved.includes(c));
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  function toggleCategory(value: string) {
    setCategories((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const result = await setPersonDisabilitiesAction(slug, personId, {
      categories,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success("Disability records saved.");
      setSaved([...categories]);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Disabilities</h2>
      <p className="text-sm text-muted-foreground">
        Recorded from staff observation, per the SASR instructions — not a
        survey of the congregation.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Disability categories</legend>
          {DISABILITY_CATEGORIES.map((category) => (
            <label
              key={category.value}
              className="inline-flex min-h-11 items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={categories.includes(category.value)}
                onChange={() => toggleCategory(category.value)}
                className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
              {category.label}
            </label>
          ))}
        </fieldset>

        <Button type="submit" disabled={submitting} className="min-h-11">
          {submitting ? "Saving…" : "Save disability records"}
        </Button>
      </form>
    </section>
  );
}
