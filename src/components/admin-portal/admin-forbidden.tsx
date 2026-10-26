/**
 * The platform console's one "you hold the door key but not this page's key"
 * state (Phase 3 Copy, group G). Replaces the hand-copied
 * "You don't have permission to ..." blocks one page at a time.
 *
 * ADMIN-ONLY ON PURPOSE (Phase 2 R2). It lives in `admin-portal/`, not
 * `shared/`, so it cannot become the `(org)` miss response, which
 * DECISION-040 requires to be byte-identical across relationship statuses.
 * This one varies by page title and area, and that is fine here: the console
 * has no tenant-enumeration surface.
 *
 * The developer portal (/developer) is the second platform consumer: its
 * forbidden state reuses this component with area "the developer portal".
 *
 * It claims only that the account lacks the capability, never why, and it is
 * actionable: a platform administrator can assign the role at /admin/users.
 *
 * `title` is the page's own title (the page would have rendered it as its
 * `<h1>`); `area` completes "Your account doesn't include {area}."
 */
export function AdminForbidden({
  title,
  area,
}: {
  title: string;
  area: string;
}) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your account doesn&apos;t include {area}. Ask a platform administrator
        if you need it.
      </p>
    </section>
  );
}
