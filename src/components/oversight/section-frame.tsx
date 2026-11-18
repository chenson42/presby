import type { ReactNode } from "react";

/**
 * One section of the record page: a heading, an optional action, and the
 * section's own state (its rows, its Locked card, its empty state or its load
 * error). The `id` ties the heading to the region for assistive technology.
 */
export function SectionFrame({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4 rounded-lg border border-border p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id={`${id}-heading`} className="text-xl font-semibold">
          {title}
        </h2>
        {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
