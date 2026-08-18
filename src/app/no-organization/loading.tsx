/**
 * This page reads the relationship list before it knows which of five things to
 * say, so it has an async beat. A skeleton shaped like the page keeps the two
 * doors from jumping into place under the reader's thumb.
 */
export default function NoOrganizationLoading() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <div role="status" aria-label="Loading" className="space-y-3">
        <div className="h-8 w-3/4 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-2/3 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="mt-10 space-y-6 border-t border-border pt-8">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-5 w-1/2 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </div>
    </main>
  );
}
