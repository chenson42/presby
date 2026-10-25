import type { ReactNode } from "react";

/**
 * The `docs/ui-standards.md` empty-state block: dashed border, a title, one
 * line of orientation and, when there is a next step, an action.
 *
 * Presentation only. "None yet" and "no matches" are different situations with
 * different next steps, and the CALLER chooses the words; this component does
 * not decide which one it is showing.
 *
 * Not adopted by `CommunityEmptyState` in the pipeline that introduced it.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center sm:py-16">
      <p className="text-sm font-medium">{title}</p>
      {body ? (
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
