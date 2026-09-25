import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sasrFormVersions } from "@/lib/db/domain/returns";
import { previewGrantedReturn } from "@/lib/statistics-grants";
import { isFlagEnabled } from "@/lib/flags";
import { SASR_FIELD_GROUPS, type SasrFieldGroup } from "@/lib/sasr-fields";
import { GenericInactiveNotice } from "./generic-inactive-notice";
import { StatisticsSubmitForm, type SasrFieldBounds } from "./statistics-submit-form";

const SUBMISSION_GRANTS_FLAG = "statistics.submission_grants";

/**
 * `/file-statistics?token=<opaque>` — the public, session-less SASR filing
 * page (D16, DECISION-147, `docs/work-log/2026-09-25-submission-grants.md`).
 * Server Component: the token is resolved HERE, server-side only, via the
 * READ-ONLY `previewGrantedReturn()` — never `presby_submit_granted_return()`
 * itself, which is a write. On every non-live outcome (no token, nonexistent,
 * expired, revoked, already submitted, stale affiliation, or the feature flag
 * off) this renders `<GenericInactiveNotice>` — the SAME markup regardless of
 * cause (Phase 2's enumeration-safety rule: distinguishing them in the UI
 * would leak exactly what the uniform SQL literal exists to hide).
 *
 * No `layout.tsx`, no `loading.tsx` in this route group (Phase 2 BINDING) —
 * a Suspense boundary would flush a premature 200 before this page's
 * terminal state is known. Platform chrome only: no `<BrandTokens>`, no
 * `read-org-brand`, no `*-brand` utility — `(statistics-submit)` is
 * un-brandable (DECISION-047/147). The organization's NAME is shown once a
 * live grant is confirmed (v1 ships name-only, no logo — Phase 2's own
 * recommendation to avoid a second anonymous blob-storage read for a
 * marginal trust gain).
 */
export default async function FileStatisticsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return <GenericInactiveNotice />;
  }

  // `previewGrantedReturn()` (`src/lib/statistics-grants.ts`) does NOT check
  // `statistics.submission_grants` itself — only the WRITE boundary
  // (`submitStatisticsGrant()`) does. Phase 2's BINDING enumeration rule
  // covers the PAGE too ("Flag-off on the public page must render the same
  // generic copy as an invalid token"), so this page checks it directly.
  // Both branches perform exactly the same one flag-check + one indexed
  // preview lookup, run in parallel, so a flag-off response costs the same
  // as a live one — never short-circuited ahead of the real DB lookup.
  const [flagOn, preview] = await Promise.all([
    isFlagEnabled(SUBMISSION_GRANTS_FLAG),
    previewGrantedReturn(token),
  ]);
  if (!flagOn || !preview) {
    return <GenericInactiveNotice />;
  }

  const groups: SasrFieldGroup[] = SASR_FIELD_GROUPS[preview.formVersionKey] ?? [];
  if (groups.length === 0) {
    // A live grant naming a form version this file has no labels for yet —
    // should not happen given only '2024' is seeded with a complete spec,
    // but a missing label set is a config gap, not a credential state, and
    // gets its own (still generic-to-the-visitor) notice rather than a
    // broken form.
    return <GenericInactiveNotice />;
  }

  const bounds = await loadFieldBounds(preview.formVersionKey);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <div className="mb-8 space-y-1">
        <p className="text-sm text-muted-foreground">Annual statistical report</p>
        <h1 className="text-2xl font-semibold">{preview.aboutOrgName}</h1>
        <p className="text-sm text-muted-foreground">
          {preview.reportYear} report — fill in every field you have data for.
          Fields left blank are recorded as zero. Nothing is saved until you
          submit.
        </p>
      </div>

      <StatisticsSubmitForm
        token={token}
        reportYear={preview.reportYear}
        formVersionKey={preview.formVersionKey}
        groups={groups}
        bounds={bounds}
      />
    </main>
  );
}

/**
 * Reads `sasr_form_versions.field_spec` for the ONE thing `src/lib/
 * sasr-fields.ts` deliberately does not carry: per-field min/max and the
 * declared JSON type. `sasr_form_versions` carries no RLS at all (platform-
 * wide reference data, written only by migration — see that table's own
 * header) so the plain `db` connection reads it with no org context, safely,
 * on the anonymous path. Never hand-rolls a second copy of the bounds —
 * Phase 3's contract note: "do not hand-roll a second copy of min/max."
 */
async function loadFieldBounds(
  formVersionKey: string,
): Promise<Record<string, SasrFieldBounds>> {
  const [row] = await db
    .select({ fieldSpec: sasrFormVersions.fieldSpec })
    .from(sasrFormVersions)
    .where(eq(sasrFormVersions.key, formVersionKey))
    .limit(1);

  const fields = (row?.fieldSpec as { fields?: Record<string, unknown> } | undefined)
    ?.fields;
  if (!fields || typeof fields !== "object") return {};

  const bounds: Record<string, SasrFieldBounds> = {};
  for (const [key, raw] of Object.entries(fields)) {
    const spec = raw as { type?: string; min?: number; max?: number };
    if (typeof spec.min !== "number" || typeof spec.max !== "number") continue;
    bounds[key] = {
      min: spec.min,
      max: spec.max,
      type: spec.type === "numeric" ? "numeric" : "integer",
    };
  }
  return bounds;
}
