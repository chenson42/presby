"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DonorPickerRow } from "@/lib/giving/donors";
import { searchDonorsAction } from "../actions";

/**
 * Search-then-pick donor selector for the offline-gift form - docs/work-log/
 * 2026-10-15-online-giving.md, Flow 8 / G24 ("search for an existing donor
 * before creating one"). There is no Select/Command/Popover primitive in this
 * repo (docs/ui-standards.md: "don't hand-roll a substitute"), so this is the
 * always-visible listbox pattern: a search field, and the matches rendered as
 * a list directly beneath it - no popover, no focus trap.
 *
 * It shows what `searchDonors` returns and nothing more: a name, whether the
 * plate-offering donor, and whether an email is on file (a boolean - the
 * address itself never reaches a recorder). Results are fetched through a
 * server action on a short debounce; while a request is in flight the list
 * shows skeleton rows, and a failure says so (never an empty list that reads
 * as "no such donor").
 *
 * Controlled by the parent form: `value` is the chosen donor (or null) and
 * `onChange` receives the pick. Rendered inside the form's `<HydrationGate>`.
 */
export function DonorPicker({
  slug,
  value,
  onChange,
  describedBy,
  invalid,
  inputId,
}: {
  slug: string;
  value: { id: string; displayName: string } | null;
  onChange: (donor: { id: string; displayName: string } | null) => void;
  describedBy?: string;
  invalid?: boolean;
  inputId: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DonorPickerRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (value) return;
    const text = query.trim();
    if (text.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results when the query is too short is the effect's job
      setResults(null);
      setFailed(null);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const result = await searchDonorsAction(slug, text);
      if (seq !== requestSeq.current) return; // a newer keystroke superseded this one
      setLoading(false);
      if (result.ok) {
        setFailed(null);
        setResults(result.data?.donors ?? []);
      } else {
        setResults(null);
        setFailed(result.error);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, slug, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-input bg-background px-3 py-2">
        <p className="min-w-0 truncate text-base font-medium" data-testid="chosen-donor">
          {value.displayName}
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 shrink-0"
          onClick={() => {
            onChange(null);
            setQuery("");
            setResults(null);
          }}
        >
          <X className="size-4" aria-hidden />
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={inputId}
          type="search"
          autoComplete="off"
          placeholder="Start typing a name"
          className="pl-9"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {query.trim().length < 2 && (
        <p className="text-sm text-muted-foreground">Type at least two letters of the donor&apos;s name.</p>
      )}

      {loading && (
        <ul aria-hidden className="space-y-2">
          {[0, 1].map((i) => (
            <li key={i} className="h-11 animate-pulse rounded-md bg-muted" />
          ))}
        </ul>
      )}

      {failed && !loading && (
        <p role="alert" className="text-sm text-destructive">
          {failed}
        </p>
      )}

      {results && !loading && results.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No one with that name is in your records yet. Choose &ldquo;A new donor&rdquo; above to add them.
        </p>
      )}

      {results && !loading && results.length > 0 && (
        <ul className="space-y-2" aria-label="Matching donors">
          {results.map((donor) => (
            <li key={donor.id}>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full justify-start"
                onClick={() => onChange({ id: donor.id, displayName: donor.displayName })}
              >
                <span className="truncate">{donor.displayName}</span>
                {donor.kind === "unidentified" && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">plate offering</span>
                )}
                {donor.kind === "identified" && !donor.hasEmail && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">no email on file</span>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
