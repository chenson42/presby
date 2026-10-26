import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, NativeSelect, fieldA11y } from "@/components/giving/form-field";
import { COPY } from "@/lib/reimbursement/copy";
import type { QueueQuery } from "@/lib/reimbursement/queue-query";
import type { TreasurerListItem } from "@/lib/reimbursement/reads";
import { groupSelectOptions, isFiltered, queueHref } from "./queue-model";

/**
 * The queue's filter bar (Copy C7, amendment S7): `Charged to`, `Submitted from`,
 * `Submitted to`, `Filter` and `Clear`. A plain `<form method="get">`: the filters
 * live in the URL (shareable, back-button safe, the CSV link carries the dates),
 * and a GET form has no react-hook-form root, so there is nothing to hydrate and
 * no `HydrationGate` to owe (the giving gifts list's filter bar is the same).
 * Built from the PARSED query (X7), so it shows exactly the filter applied.
 *
 * The group options are `listTreasurerGroups`' derived list; `truncated` shows the
 * 2,000-request hint under the select. A selected group the list lacks stays
 * selected (`groupSelectOptions`). The date inputs are the browser's own. The
 * current tab rides along as a hidden field; a new search starts at page 1.
 * Server component.
 */
export function QueueFilters({
  slug,
  query,
  groups,
  truncated,
  rows,
}: {
  slug: string;
  query: QueueQuery;
  groups: Array<{ id: string; name: string }>;
  truncated: boolean;
  rows: TreasurerListItem[];
}) {
  const options = groupSelectOptions(groups, query.groupId, rows);
  const hasHint = truncated;
  return (
    <form
      method="get"
      action={`/o/${slug}/admin/reimbursements`}
      className="space-y-4 rounded-lg border border-border p-4"
      data-testid="queue-filters"
    >
      <input type="hidden" name="tab" value={query.tab} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField
          id="queue-group"
          label={COPY.queue.chargedTo}
          hint={hasHint ? COPY.queue.filter.groupsTruncated : undefined}
        >
          <NativeSelect name="group" defaultValue={query.groupId ?? ""} className="min-h-11" {...fieldA11y("queue-group", undefined, hasHint)}>
            <option value="">{COPY.queue.filter.groupAll}</option>
            {options.extraSelected && <option value={options.extraSelected.id}>{options.extraSelected.name}</option>}
            {options.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="queue-from" label={COPY.queue.filter.submittedFrom}>
          <Input type="date" name="from" defaultValue={query.from ?? ""} className="min-h-11" {...fieldA11y("queue-from", undefined)} />
        </FormField>
        <FormField id="queue-to" label={COPY.queue.filter.submittedTo}>
          <Input type="date" name="to" defaultValue={query.to ?? ""} className="min-h-11" {...fieldA11y("queue-to", undefined)} />
        </FormField>
      </div>
      <p className="text-sm text-muted-foreground">{COPY.queue.filter.datesHint}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11">
          {COPY.queue.filter.apply}
        </Button>
        {isFiltered(query) && (
          <Button asChild variant="outline" className="min-h-11">
            <Link href={queueHref(slug, { ...query, groupId: null, from: null, to: null, page: 1 })}>{COPY.queue.filter.clear}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
