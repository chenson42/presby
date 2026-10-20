import type { ChecklistRecord } from "@/lib/domains/checklist";
import { HINT_COPY } from "@/lib/domains/hints";
import { DomainCopyButton } from "./domain-copy-button";
import { DomainStatusChip } from "./domain-status-chip";

/**
 * One DNS record. A stacked `<dl>` at 360px (Type / Name / Value / Status), the
 * value in monospace with `break-all` so a long TXT value wraps instead of
 * pushing the page sideways, and an 44px Copy control per copyable field. From
 * `md:` the same four fields sit in one row; it is a list of definition lists,
 * not a div grid pretending to be a table.
 *
 * `compact` (the offboarding list) drops the copy buttons and the status.
 */
export function DomainRecordRow({
  record,
  id,
  compact = false,
}: {
  record: ChecklistRecord;
  /** A unique DOM id prefix, so the copy fallback can select the value's text. */
  id: string;
  compact?: boolean;
}) {
  const nameId = `${id}-name`;
  const valueId = `${id}-value`;
  const hint = record.hint ? HINT_COPY[record.hint] : null;
  const showKeep = record.keep && record.hint !== "keep_record";
  return (
    <li data-record-kind={record.kind} data-record-type={record.type} className="rounded-md border border-border bg-card p-3">
      <dl className="grid gap-3 md:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1.6fr)_auto] md:items-start">
        <div>
          <dt className="text-sm text-muted-foreground">Type</dt>
          <dd className="font-mono text-base font-medium">{record.type}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-sm text-muted-foreground">Name</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <code id={nameId} className="break-all font-mono text-base select-all">
              {record.name}
            </code>
            {!compact && <DomainCopyButton value={record.name} label="the record name" targetId={nameId} />}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-sm text-muted-foreground">Value</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <code id={valueId} className="break-all font-mono text-base select-all">
              {record.value}
            </code>
            {!compact && <DomainCopyButton value={record.value} label="the record value" targetId={valueId} />}
          </dd>
        </div>
        {!compact && (
          <div>
            <dt className="text-sm text-muted-foreground">Status</dt>
            <dd>
              <DomainStatusChip status={record.status} />
            </dd>
          </div>
        )}
      </dl>
      {(hint || showKeep) && !compact && (
        <p className="mt-3 text-sm text-muted-foreground">{hint ?? HINT_COPY.keep_record}</p>
      )}
    </li>
  );
}
