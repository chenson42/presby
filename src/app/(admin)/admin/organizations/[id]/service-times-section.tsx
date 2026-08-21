"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ServiceTimeAdminEntry } from "@/lib/sites";
import { setOrganizationServiceTimesAction, type PolicyResult } from "./actions";

/**
 * Fifth section on `/admin/organizations/<id>` — two independent structured
 * schedule editors (docs/work-log/2026-08-21-public-site-org-profile.md
 * Phase 3, "Component / Page Plan"). TWO SAVES, NOT ONE: a church may set
 * service times without office hours and the reverse — coupling them into
 * one submit would force an all-or-nothing save neither Phase 1 nor Phase 2
 * asked for. `kind` is baked into each `<TimeRowsEditor>` instance and
 * travels as a hidden field, never user-editable.
 *
 * Each row's own fields (day/start/end/label) live in plain client state —
 * NOT individually `name`d inputs — because what actually gets submitted is
 * the whole row array serialized to JSON into one hidden `rows` field,
 * matching DECISION-092's whole-list-replace server contract exactly.
 */

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface Row {
  key: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  label: string;
}

function toRows(entries: ServiceTimeAdminEntry[]): Row[] {
  return entries.map((entry) => ({
    key: entry.id,
    dayOfWeek: entry.dayOfWeek,
    // Server returns "HH:MM:SS" (the Postgres `time` literal); a native
    // <input type="time"> wants "HH:MM".
    startTime: entry.startTime.slice(0, 5),
    endTime: entry.endTime.slice(0, 5),
    label: entry.label ?? "",
  }));
}

let rowKeySeq = 0;
function newRowKey(): string {
  rowKeySeq += 1;
  return `new-row-${rowKeySeq}`;
}

async function submitServiceTimes(
  _prev: PolicyResult | null,
  formData: FormData,
): Promise<PolicyResult> {
  return setOrganizationServiceTimesAction(formData);
}

function TimeRowsEditor({
  organizationId,
  kind,
  title,
  helpText,
  initialEntries,
}: {
  organizationId: string;
  kind: "service" | "office_hours";
  title: string;
  helpText: string;
  initialEntries: ServiceTimeAdminEntry[];
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(initialEntries));
  const [result, formAction, isPending] = useActionState(
    submitServiceTimes,
    null as PolicyResult | null,
  );
  const formId = useId();

  useEffect(() => {
    if (!result) return;
    if (result.ok) {
      toast.success(`${title} saved.`);
    } else {
      toast.error(result.error);
    }
  }, [result, title]);

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        key: newRowKey(),
        dayOfWeek: 0,
        startTime: "10:00",
        endTime: "11:00",
        label: "",
      },
    ]);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key));
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  const rowsJson = JSON.stringify(
    rows.map((row) => ({
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
      label: row.label.trim().length > 0 ? row.label.trim() : null,
    })),
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{helpText}</p>
      </div>

      {result && (
        <div
          role="status"
          className={
            result.ok
              ? "rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
              : "rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          }
        >
          {result.ok ? `${title} saved.` : result.error}
        </div>
      )}

      <div className="space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No rows yet — add one below.
          </p>
        )}
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
          >
            <div>
              <Label htmlFor={`${formId}-${row.key}-day`}>Day</Label>
              <select
                id={`${formId}-${row.key}-day`}
                value={row.dayOfWeek}
                onChange={(e) =>
                  updateRow(row.key, { dayOfWeek: Number(e.target.value) })
                }
                className="mt-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {DAY_LABELS.map((label, i) => (
                  <option key={label} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor={`${formId}-${row.key}-start`}>Start</Label>
              <Input
                id={`${formId}-${row.key}-start`}
                type="time"
                value={row.startTime}
                onChange={(e) =>
                  updateRow(row.key, { startTime: e.target.value })
                }
                className="w-32"
              />
            </div>
            <div>
              <Label htmlFor={`${formId}-${row.key}-end`}>End</Label>
              <Input
                id={`${formId}-${row.key}-end`}
                type="time"
                value={row.endTime}
                onChange={(e) =>
                  updateRow(row.key, { endTime: e.target.value })
                }
                className="w-32"
              />
            </div>
            <div className="min-w-40 flex-1">
              <Label htmlFor={`${formId}-${row.key}-label`}>
                Label (optional)
              </Label>
              <Input
                id={`${formId}-${row.key}-label`}
                type="text"
                value={row.label}
                onChange={(e) => updateRow(row.key, { label: e.target.value })}
                placeholder="Traditional"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => removeRow(row.key)}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          Add row
        </Button>

        <form action={formAction} className="contents">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="rows" value={rowsJson} />
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Saving…" : `Save ${title.toLowerCase()}`}
          </Button>
        </form>
      </div>
    </div>
  );
}

export function ServiceTimesSection({
  organizationId,
  serviceEntries,
  officeHoursEntries,
}: {
  organizationId: string;
  serviceEntries: ServiceTimeAdminEntry[];
  officeHoursEntries: ServiceTimeAdminEntry[];
}) {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Service times &amp; office hours
      </h2>
      <div className="mt-3 grid gap-8 lg:grid-cols-2">
        <TimeRowsEditor
          organizationId={organizationId}
          kind="service"
          title="Service times"
          helpText="Regular worship service times shown on the public site."
          initialEntries={serviceEntries}
        />
        <TimeRowsEditor
          organizationId={organizationId}
          kind="office_hours"
          title="Office hours"
          helpText="Regular office hours shown on the public site."
          initialEntries={officeHoursEntries}
        />
      </div>
    </section>
  );
}
