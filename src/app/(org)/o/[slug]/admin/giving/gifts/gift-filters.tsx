import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, NativeSelect, fieldA11y } from "@/components/giving/form-field";
import type { GiftFilters } from "@/lib/giving/gift-input";
import type { FundOption } from "@/lib/giving/funds";

/**
 * The gift list's filters - a plain `<form method="get">`: the filters live in
 * the URL (shareable, back-button safe, the CSV link carries them), and a GET
 * form needs no JavaScript, so there is nothing to hydrate and no
 * HydrationGate to owe (it is not a react-hook-form root). A server component.
 * Date inputs are the browser's own `type="date"`.
 */
export function GiftFilterForm({
  slug,
  funds,
  filters,
}: {
  slug: string;
  funds: FundOption[];
  filters: GiftFilters;
}) {
  const action = `/o/${slug}/admin/giving/gifts`;
  const active = Object.keys(filters).length > 0;
  return (
    <form method="get" action={action} className="space-y-4 rounded-lg border border-border p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField id="filter-from" label="From">
          <Input type="date" name="from" defaultValue={filters.from ?? ""} {...fieldA11y("filter-from", undefined)} />
        </FormField>
        <FormField id="filter-to" label="To">
          <Input type="date" name="to" defaultValue={filters.to ?? ""} {...fieldA11y("filter-to", undefined)} />
        </FormField>
        <FormField id="filter-fund" label="Fund">
          <NativeSelect name="fund" defaultValue={filters.fundId ?? ""} id="filter-fund">
            <option value="">All funds</option>
            {funds.map((fund) => (
              <option key={fund.id} value={fund.id}>
                {fund.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="filter-status" label="Status">
          <NativeSelect name="status" defaultValue={filters.status ?? ""} id="filter-status">
            <option value="">Any status</option>
            <option value="succeeded">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </NativeSelect>
        </FormField>
        <FormField id="filter-source" label="Source">
          <NativeSelect name="source" defaultValue={filters.source ?? ""} id="filter-source">
            <option value="">Online and by hand</option>
            <option value="online">Online</option>
            <option value="offline">Recorded by hand</option>
          </NativeSelect>
        </FormField>
      </div>
      {filters.donorId && <input type="hidden" name="donor" value={filters.donorId} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11">
          Apply filters
        </Button>
        {active && (
          <Button asChild variant="outline" className="min-h-11">
            <Link href={action}>Clear filters</Link>
          </Button>
        )}
      </div>
    </form>
  );
}

/** The querystring for the current filters (and an optional cursor), for links. */
export function giftQuery(filters: GiftFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.fundId) params.set("fund", filters.fundId);
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  if (filters.donorId) params.set("donor", filters.donorId);
  if (cursor) params.set("cursor", cursor);
  const text = params.toString();
  return text ? `?${text}` : "";
}
