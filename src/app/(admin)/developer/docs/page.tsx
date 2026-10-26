import { FormattedDate } from "@/components/shared/formatted-date";
import {
  DOCS_REVIEWED,
  DOC_KIND_LABEL,
  DOC_ROWS,
} from "@/lib/developer-portal/docs-registry";
import { requireDeveloper } from "../guard";
import { GateState } from "../gate-state";
import { ProvenanceLabel } from "../provenance-label";

export const metadata = { title: "Documentation" };

/**
 * Documentation: honest placeholders. Nothing is rendered from the files; each
 * row says what the document will contain and where the material lives today.
 * The page claims only that the files exist and that a person last looked on
 * `DOCS_REVIEWED`, never that anything is complete or current.
 */
export default async function DeveloperDocs() {
  const gate = await requireDeveloper("/developer/docs");
  if (gate !== "ok") {
    return <GateState gate={gate} retryHref="/developer/docs" />;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">Documentation</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        What documentation exists, where it lives today, and what is planned for
        this portal. Nothing here is rendered yet; each document is a file in
        the repository.
      </p>

      <ul className="mt-8 divide-y divide-border border-y border-border">
        {DOC_ROWS.map((row) => (
          <li key={row.key} className="py-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{row.title}</h2>
              <span className="text-xs text-muted-foreground">
                {DOC_KIND_LABEL[row.kind]}
              </span>
              <ProvenanceLabel kind="planned" />
            </div>
            <p className="mt-2 text-sm">{row.willContain}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {"text" in row.livesToday ? (
                <>Planned. Not built yet. Today, {row.livesToday.text}</>
              ) : (
                <>
                  Planned. Not built yet. Today this material lives in{" "}
                  {row.livesToday.files.map((f, i) => (
                    <span key={f}>
                      {i > 0 && " and "}
                      <code className="break-all font-mono text-xs text-foreground">
                        {f}
                      </code>
                    </span>
                  ))}
                  .
                </>
              )}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-sm text-muted-foreground">
        Reviewed <FormattedDate value={DOCS_REVIEWED} mode="date" />
      </p>
    </div>
  );
}
