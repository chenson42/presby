/**
 * Card-shaped skeleton, not a spinner: the chooser's layout is known before its
 * data is, so reserving the shape prevents the grid snapping into place under
 * the user's thumb (docs/ui-standards.md → Loading & Error States).
 *
 * Two placeholders because two is the commonest non-trivial case — a member of
 * a congregation who also serves the presbytery.
 */
export default function OrgsLoading() {
  return (
    <div className="space-y-8">
      <div>
        <div className="h-8 w-72 max-w-full animate-pulse rounded-md bg-muted" />
        <div className="mt-2 h-4 w-56 max-w-full animate-pulse rounded-md bg-muted" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-40 animate-pulse rounded-md bg-muted" />
        <div
          role="status"
          aria-label="Loading your organizations"
          className="grid gap-4 sm:grid-cols-2"
        >
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-border bg-muted"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
