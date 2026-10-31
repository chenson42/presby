"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COPY } from "@/lib/reimbursement/copy";
import { BENEFICIARY_QUERY_MAX, BENEFICIARY_QUERY_MIN } from "@/lib/reimbursement/limits";
import type { BeneficiaryCandidate } from "@/lib/reimbursement/pickers";
import { searchBeneficiariesAction } from "./actions";

/**
 * "Who are we paying back?" - the picker for "Pay someone else back" (a holder of
 * `reimbursement.request_for_others`). docs/work-log/2026-10-25-treasury-inc1.md,
 * Copy C3 and the Batch 2a amendment T3, EC17, residual 6.
 *
 * Names only come back from the server (at most eight, never an email or phone),
 * and the id this posts is NEVER trusted: `saveRequest` re-checks it against the
 * directory. The server returns the same empty list for "no match", "you may not
 * search" and "that person is hidden", so this shows `No match.` for all of them
 * and the standing hint says why a person may be missing.
 *
 * Behaviour pinned by the amendment:
 *   - under 2 characters: nothing is shown and no request is made (so `No match.`
 *     is never shown for a query too short to search);
 *   - search ran, nothing came back: `No match.` in a polite status;
 *   - people came back: the list, and a visually hidden polite status
 *     `1 person found.` / `{n} people found.`;
 *   - a gate refusal shows the action's own error text under the box; a thrown
 *     call or a dropped network shows `We couldn't search just now. Try again.`;
 *   - once someone is picked their name replaces the box, with a `Change` button
 *     whose accessible name is `Change who we are paying back`.
 *
 * Not a form: Enter in the search box does nothing (it must never reach the
 * request form's submit). Debounced; a stale reply (an older query finishing
 * after a newer one) is dropped by a sequence number.
 */

const DEBOUNCE_MS = 250;

export interface PickedBeneficiary {
  personId: string;
  name: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "found"; candidates: BeneficiaryCandidate[] }
  | { kind: "failed"; message: string };

export function BeneficiaryPicker({
  slug,
  id,
  value,
  onChange,
  invalid,
  describedBy,
  disabled,
  inputRef,
}: {
  slug: string;
  id: string;
  value: PickedBeneficiary | null;
  onChange: (next: PickedBeneficiary | null) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function run(text: string) {
    const mine = ++seq.current;
    try {
      const result = await searchBeneficiariesAction(slug, { query: text });
      if (mine !== seq.current) return; // a newer search is in flight or finished
      if (result.ok) setStatus({ kind: "found", candidates: result.data.candidates });
      else setStatus({ kind: "failed", message: result.error });
    } catch {
      if (mine !== seq.current) return;
      setStatus({ kind: "failed", message: COPY.form.searchFailed });
    }
  }

  function handleQuery(text: string) {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    const trimmed = text.trim();
    if (trimmed.length < BENEFICIARY_QUERY_MIN) {
      seq.current++; // drop any reply still on its way
      setStatus({ kind: "idle" });
      return;
    }
    timer.current = setTimeout(() => void run(trimmed), DEBOUNCE_MS);
  }

  function pick(candidate: BeneficiaryCandidate) {
    seq.current++;
    setQuery("");
    setStatus({ kind: "idle" });
    onChange({ personId: candidate.personId, name: candidate.displayName });
  }

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <Input
          id={id}
          ref={inputRef}
          readOnly
          value={value.name}
          className="min-h-11"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          data-testid="beneficiary-chosen"
        />
        <Button
          type="button"
          variant="outline"
          className="min-h-11 shrink-0"
          aria-label={COPY.form.changeBeneficiaryLabel}
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          {COPY.form.changeBeneficiary}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Input
        id={id}
        ref={inputRef}
        type="search"
        autoComplete="off"
        maxLength={BENEFICIARY_QUERY_MAX}
        className="min-h-11"
        placeholder={COPY.form.beneficiaryPlaceholder}
        value={query}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => handleQuery(e.target.value)}
        onKeyDown={(e) => {
          // Enter must never reach the request form.
          if (e.key === "Enter") e.preventDefault();
        }}
      />
      {status.kind === "found" && status.candidates.length === 0 && (
        <p role="status" className="mt-2 text-sm text-muted-foreground" data-testid="beneficiary-no-match">
          {COPY.form.beneficiaryNoMatch}
        </p>
      )}
      {status.kind === "found" && status.candidates.length > 0 && (
        <>
          <p role="status" className="sr-only">
            {COPY.form.searchFound(status.candidates.length)}
          </p>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border" data-testid="beneficiary-results">
            {status.candidates.map((candidate) => (
              <li key={candidate.personId}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center px-3 py-2 text-left text-base [overflow-wrap:anywhere] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => pick(candidate)}
                >
                  {candidate.displayName}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {status.kind === "failed" && (
        <p role="alert" className="mt-2 text-sm text-destructive" data-testid="beneficiary-search-failed">
          {status.message}
        </p>
      )}
    </div>
  );
}
