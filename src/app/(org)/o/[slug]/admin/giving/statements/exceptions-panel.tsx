import Link from "next/link";
import type { StatementRunPreview } from "@/lib/giving/statements";

/**
 * "What needs a look" for a year's run (Flow 11, step 2): the things that
 * change what a statement says or whether it can be delivered, each in a
 * sentence with the one place to act. An item appears only when its count is
 * above zero; when nothing does, the panel says so (an honest empty state, not
 * a hidden panel). Counts come from `previewStatementRun`; names are shown only
 * for donors the church cannot reach (so the treasurer can fix the record), and
 * never an amount. A server component.
 */
export function ExceptionsPanel({
  slug,
  year,
  preview,
}: {
  slug: string;
  year: number;
  preview: StatementRunPreview;
}) {
  const base = `/o/${slug}/admin/giving`;
  const items: Array<{ key: string; node: React.ReactNode }> = [];

  if (preview.stale > 0) {
    items.push({
      key: "stale",
      node: (
        <>
          <strong>{preview.stale}</strong> {preview.stale === 1 ? "statement is" : "statements are"} out of date: a gift or
          refund changed after {preview.stale === 1 ? "it was" : "they were"} issued.{" "}
          <Link className="underline underline-offset-4" href={`${base}/statements?year=${year}&filter=stale`}>
            Review out-of-date statements
          </Link>
          .
        </>
      ),
    });
  }
  if (preview.excludedPending > 0) {
    items.push({
      key: "pending",
      node: (
        <>
          <strong>{preview.excludedPending}</strong> {preview.excludedPending === 1 ? "gift is" : "gifts are"} still pending
          (a bank transfer that hasn&apos;t cleared), so {preview.excludedPending === 1 ? "it isn't" : "they aren't"} on any
          statement yet. When {preview.excludedPending === 1 ? "it clears" : "they clear"} the donor&apos;s statement will
          show as out of date and you can issue a correction.{" "}
          <Link
            className="underline underline-offset-4"
            href={`${base}/gifts?status=pending&from=${year}-01-01&to=${year}-12-31`}
          >
            See pending gifts
          </Link>
          .
        </>
      ),
    });
  }
  if (preview.undeliverable > 0) {
    items.push({
      key: "undeliverable",
      node: (
        <>
          <strong>{preview.undeliverable}</strong> {preview.undeliverable === 1 ? "donor has" : "donors have"} no email and no
          mailing address, so {preview.undeliverable === 1 ? "their statement" : "their statements"} can be issued but not
          sent. Add contact details first:
          <ul className="mt-2 flex flex-wrap gap-2">
            {preview.undeliverableDonors.map((d) => (
              <li key={d.id}>
                <Link
                  className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm underline underline-offset-4"
                  href={`${base}/donors/${d.id}`}
                >
                  {d.name}
                </Link>
              </li>
            ))}
          </ul>
          {preview.undeliverable > preview.undeliverableDonors.length && (
            <span className="mt-1 block text-muted-foreground">
              &hellip;and {preview.undeliverable - preview.undeliverableDonors.length} more.
            </span>
          )}
        </>
      ),
    });
  }
  if (preview.possibleDuplicates > 0) {
    items.push({
      key: "duplicates",
      node: (
        <>
          <strong>{preview.possibleDuplicates}</strong> possible duplicate{" "}
          {preview.possibleDuplicates === 1 ? "donor" : "donors"}: if two records are one giver, merge them before issuing
          so the giver gets one statement.{" "}
          <Link className="underline underline-offset-4" href={`${base}/donors`}>
            Check donors
          </Link>
          .
        </>
      ),
    });
  }
  if (preview.nonCash > 0) {
    items.push({
      key: "noncash",
      node: (
        <>
          <strong>{preview.nonCash}</strong> non-cash {preview.nonCash === 1 ? "gift" : "gifts"} (stock) will be described on
          the statement without a value, as the IRS expects.
        </>
      ),
    });
  }
  if (preview.plateCashExcluded > 0) {
    items.push({
      key: "plate",
      node: (
        <>
          <strong>{preview.plateCashExcluded}</strong> cash {preview.plateCashExcluded === 1 ? "gift was" : "gifts were"}{" "}
          recorded without a donor (loose offering), so {preview.plateCashExcluded === 1 ? "it gets" : "they get"} no
          statement.
        </>
      ),
    });
  }

  return (
    <section aria-labelledby="exceptions-heading" className="rounded-lg border border-border p-4" data-testid="exceptions-panel">
      <h2 id="exceptions-heading" className="text-xl font-semibold">
        What needs a look
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing needs attention for {year}.</p>
      ) : (
        <ul className="mt-3 space-y-3 text-sm">
          {items.map((item) => (
            <li key={item.key} data-testid={`exception-${item.key}`}>
              {item.node}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
