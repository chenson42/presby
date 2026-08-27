"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SensitiveInfoForEdit } from "@/lib/person-sensitive";
import {
  addPersonNoteAction,
  setPersonDemographicsAction,
  setPersonMedicalAction,
  setPersonDisabilitiesAction,
} from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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
  return (
    <div className="space-y-10">
      {data.grants.pastoralNotes && (
        <PastoralNotesSection
          slug={slug}
          personId={personId}
          notes={data.notes ?? []}
        />
      )}
      {data.grants.demographics && (
        <DemographicsSection
          slug={slug}
          personId={personId}
          initial={data.demographics ?? null}
        />
      )}
      {data.grants.medical && (
        <MedicalSection
          slug={slug}
          personId={personId}
          initial={data.medical ?? null}
        />
      )}
      {data.grants.disabilities && data.disabilityTrackingEnabled && (
        <DisabilitiesSection
          slug={slug}
          personId={personId}
          initial={data.disabilities ?? []}
        />
      )}
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
}: {
  slug: string;
  personId: string;
  notes: NonNullable<SensitiveInfoForEdit["notes"]>;
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
        <p className="text-sm text-muted-foreground">
          No notes recorded yet.
        </p>
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
          <select
            id="note-type"
            className={`${SELECT_CLASSES} mt-1`}
            value={noteType}
            onChange={(e) =>
              setNoteType(e.target.value as (typeof NOTE_TYPES)[number]["value"])
            }
          >
            {NOTE_TYPES.map((n) => (
              <option key={n.value} value={n.value}>
                {n.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="note-visibility">Visibility</Label>
          <select
            id="note-visibility"
            className={`${SELECT_CLASSES} mt-1`}
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
}: {
  slug: string;
  personId: string;
  initial: NonNullable<SensitiveInfoForEdit["demographics"]> | null;
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
          <div className="flex flex-col gap-2">
            {RACIAL_ETHNIC_OPTIONS.map((option) => (
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
            ))}
          </div>
        </fieldset>

        <div>
          <Label htmlFor="demographics-source">Source</Label>
          <select
            id="demographics-source"
            className={`${SELECT_CLASSES} mt-1`}
            value={source}
            onChange={(e) => setSource(e.target.value as "self" | "staff")}
          >
            <option value="self">Self-reported</option>
            <option value="staff">Staff-observed</option>
          </select>
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
}: {
  slug: string;
  personId: string;
  initial: NonNullable<SensitiveInfoForEdit["medical"]> | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [allergies, setAllergies] = useState(initial?.allergies ?? "");
  const [medicalNotes, setMedicalNotes] = useState(initial?.medicalNotes ?? "");
  const [medications, setMedications] = useState(initial?.medications ?? "");
  const [authorizedPickup, setAuthorizedPickup] = useState(
    initial?.authorizedPickup ?? "",
  );

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
}: {
  slug: string;
  personId: string;
  initial: string[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [categories, setCategories] = useState<string[]>(initial);

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
