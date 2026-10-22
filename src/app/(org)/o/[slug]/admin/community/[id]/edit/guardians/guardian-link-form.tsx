"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { GuardianLink, GuardianRelationship, LinkablePerson } from "@/lib/children";
import {
  addGuardianLinkAction,
  removeGuardianLinkAction,
  searchLinkablePeopleAction,
  updateGuardianLinkAction,
} from "./actions";

// Same manual-chevron reasoning as sensitive-info-form.tsx (H1, docs/
// reviews/2026-08-26-portal-ux.md).
const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const RELATIONSHIPS: Array<{ value: GuardianRelationship; label: string }> = [
  { value: "parent", label: "Parent" },
  { value: "guardian", label: "Guardian" },
  { value: "grandparent", label: "Grandparent" },
  { value: "caregiver", label: "Caregiver" },
];

const NOTES_MAX_LENGTH = 4000;
const RELATED_NAME_MAX_LENGTH = 2000;

/**
 * Add/edit/remove one guardian row at a time (Phase 3 Component Plan) —
 * mirrors `sensitive-info-form.tsx`'s controlled-input + `maxLength` +
 * server-action-call shape. Defaults to linking an EXISTING person (Phase
 * 3/DECISION-111 ruling 4); free-text name is the fallback, one radio
 * toggle away.
 */
export function GuardianLinkForm({
  slug,
  personId,
  links,
}: {
  slug: string;
  personId: string;
  links: GuardianLink[];
}) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <ul className="space-y-3">
        {links.length === 0 ? (
          <li className="rounded-lg border border-dashed border-border py-10 text-center">
            <p className="text-sm font-medium">No guardians on file</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add the first guardian below.
            </p>
          </li>
        ) : (
          links.map((link) => (
            <GuardianRow
              key={link.id}
              slug={slug}
              personId={personId}
              link={link}
              onChanged={() => router.refresh()}
            />
          ))
        )}
      </ul>

      <div className="border-t border-border pt-4">
        <h2 className="mb-3 text-lg font-medium">Add a guardian</h2>
        <AddGuardianForm
          slug={slug}
          personId={personId}
          onAdded={() => router.refresh()}
        />
      </div>
    </div>
  );
}

function relationshipLabel(value: string): string {
  return RELATIONSHIPS.find((r) => r.value === value)?.label ?? value;
}

function GuardianRow({
  slug,
  personId,
  link,
  onChanged,
}: {
  slug: string;
  personId: string;
  link: GuardianLink;
  onChanged: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [relationship, setRelationship] = useState<GuardianRelationship>(
    link.relationship,
  );
  const [isEmergencyContact, setIsEmergencyContact] = useState(
    link.isEmergencyContact,
  );
  const [notes, setNotes] = useState(link.notes ?? "");

  async function onRemove() {
    setRemoving(true);
    const result = await removeGuardianLinkAction(slug, personId, link.id);
    setRemoving(false);
    if (result.ok) {
      toast.success("Guardian removed.");
      onChanged();
    } else {
      toast.error(result.error);
    }
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const result = await updateGuardianLinkAction(slug, personId, link.id, {
      relatedPersonId: link.relatedPersonId ?? undefined,
      relatedName: link.relatedPersonId ? undefined : (link.relatedName ?? undefined),
      relationship,
      isEmergencyContact,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (result.ok) {
      toast.success("Guardian updated.");
      setEditing(false);
      onChanged();
    } else {
      toast.error(result.error);
    }
  }

  if (editing) {
    return (
      <li className="rounded-md border border-border p-3 text-sm">
        <form onSubmit={onSaveEdit} className="space-y-3">
          <p className="font-medium text-foreground">
            {link.relatedPersonId ? link.relatedPersonName : link.relatedName}
          </p>
          <div>
            <Label htmlFor={`guardian-relationship-${link.id}`}>
              Relationship
            </Label>
            <div className="relative mt-1">
              <select
                id={`guardian-relationship-${link.id}`}
                className={SELECT_CLASSES}
                value={relationship}
                onChange={(e) =>
                  setRelationship(e.target.value as GuardianRelationship)
                }
              >
                {RELATIONSHIPS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          </div>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isEmergencyContact}
              onChange={(e) => setIsEmergencyContact(e.target.checked)}
              className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            Also an emergency contact
          </label>
          <div>
            <Label htmlFor={`guardian-notes-${link.id}`}>
              Notes (optional)
            </Label>
            <Textarea
              id={`guardian-notes-${link.id}`}
              className="mt-1"
              rows={2}
              maxLength={NOTES_MAX_LENGTH}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting} className="min-h-11">
              {submitting ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-foreground">
            {link.relatedPersonId ? link.relatedPersonName : link.relatedName}
          </p>
          <p className="text-xs text-muted-foreground">
            {relationshipLabel(link.relationship)}
            {link.isEmergencyContact ? " · Emergency contact" : ""}
          </p>
          {link.notes && (
            <p className="mt-1 whitespace-pre-wrap text-sm">{link.notes}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={removing}
            onClick={onRemove}
          >
            {removing ? "Removing…" : "Remove"}
          </Button>
        </div>
      </div>
    </li>
  );
}

function AddGuardianForm({
  slug,
  personId,
  onAdded,
}: {
  slug: string;
  personId: string;
  onAdded: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "name">("existing");
  const [relationship, setRelationship] =
    useState<GuardianRelationship>("parent");
  const [isEmergencyContact, setIsEmergencyContact] = useState(false);
  const [notes, setNotes] = useState("");

  // "Link an existing person" mode
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<LinkablePerson[]>([]);
  const [selected, setSelected] = useState<LinkablePerson | null>(null);

  // "Name only" fallback mode
  const [relatedName, setRelatedName] = useState("");

  const [submitting, setSubmitting] = useState(false);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    const result = await searchLinkablePeopleAction(slug, query);
    setSearching(false);
    if (result.ok) {
      setResults(result.data?.people ?? []);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (mode === "existing" && !selected) {
      toast.error("Search for and select a person first.");
      return;
    }
    if (mode === "name" && !relatedName.trim()) {
      toast.error("Enter a name.");
      return;
    }

    setSubmitting(true);
    const result = await addGuardianLinkAction(slug, personId, {
      relatedPersonId: mode === "existing" ? selected?.personId : undefined,
      relatedName: mode === "name" ? relatedName.trim() : undefined,
      relationship,
      isEmergencyContact,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success("Guardian added.");
      setSelected(null);
      setQuery("");
      setResults([]);
      setRelatedName("");
      setNotes("");
      setIsEmergencyContact(false);
      onAdded();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset className="flex flex-col gap-2 sm:flex-row sm:gap-4">
        <legend className="sr-only">How to identify this guardian</legend>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="guardian-mode"
            checked={mode === "existing"}
            onChange={() => setMode("existing")}
          />
          Link an existing person
        </label>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="guardian-mode"
            checked={mode === "name"}
            onChange={() => setMode("name")}
          />
          Enter a name only
        </label>
      </fieldset>

      {mode === "existing" ? (
        <div className="space-y-2">
          <Label htmlFor="guardian-search">Search this organization</Label>
          <div className="flex gap-2">
            <Input
              id="guardian-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name…"
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={searching || query.trim().length === 0}
              onClick={onSearch}
            >
              {searching ? "Searching…" : "Search"}
            </Button>
          </div>
          {selected ? (
            <p className="text-sm">
              Selected:{" "}
              <span className="font-medium">
                {selected.preferredName ?? selected.firstName} {selected.lastName}
              </span>{" "}
              <button
                type="button"
                className="text-muted-foreground underline underline-offset-2"
                onClick={() => setSelected(null)}
              >
                change
              </button>
            </p>
          ) : results.length > 0 ? (
            <ul className="divide-y divide-border rounded-md border border-border">
              {results.map((person) => (
                <li key={person.personId}>
                  <button
                    type="button"
                    className="min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setSelected(person);
                      setResults([]);
                    }}
                  >
                    {person.preferredName ?? person.firstName} {person.lastName}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div>
          <Label htmlFor="guardian-related-name">Name</Label>
          <Input
            id="guardian-related-name"
            className="mt-1"
            maxLength={RELATED_NAME_MAX_LENGTH}
            value={relatedName}
            onChange={(e) => setRelatedName(e.target.value)}
          />
        </div>
      )}

      <div>
        <Label htmlFor="guardian-relationship">Relationship</Label>
        <div className="relative mt-1">
          <select
            id="guardian-relationship"
            className={SELECT_CLASSES}
            value={relationship}
            onChange={(e) =>
              setRelationship(e.target.value as GuardianRelationship)
            }
          >
            {RELATIONSHIPS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
      </div>

      <label className="inline-flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isEmergencyContact}
          onChange={(e) => setIsEmergencyContact(e.target.checked)}
          className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        Also an emergency contact
      </label>

      <div>
        <Label htmlFor="guardian-notes">Notes (optional)</Label>
        <Textarea
          id="guardian-notes"
          className="mt-1"
          rows={2}
          maxLength={NOTES_MAX_LENGTH}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Adding…" : "Add guardian"}
      </Button>
    </form>
  );
}
