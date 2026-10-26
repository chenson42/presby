import Link from "next/link";
import {
  buildSchemaDocs,
  buildPermissionDocs,
  loadDescriptions,
  moduleSlug,
  summarize,
  INVARIANTS,
  PLATFORM_MODULE,
  type TableDoc,
} from "@/lib/dev-docs";
import { requireDeveloper } from "../guard";
import { GateState } from "../gate-state";
import { ProvenanceLabel } from "../provenance-label";
import { TableFilter } from "../table-filter";
import "../developer.css";

export const metadata = {
  title: "Data model",
  description: "Generated technical reference for the PresbyPortal schema.",
};

/**
 * /developer/data-model — an index, not a document (the former /developer).
 *
 * The first version buried everything behind disclosures and led with long
 * descriptions, which made it something to read rather than something to
 * navigate. The job is finding a table or a diagram to review, so this is a
 * dense scannable list where every row is a link. Detail lives at
 * /developer/tables/<name>, diagrams at /developer/erd/<module>.
 *
 * No <details> anywhere. Disclosure widgets failed to toggle twice on the phone
 * this gets reviewed from, and real routes are linkable, shareable, and cannot
 * silently refuse to open.
 */
export default async function DataModelIndex() {
  const gate = await requireDeveloper("/developer/data-model");
  if (gate !== "ok") {
    return <GateState gate={gate} retryHref="/developer/data-model" />;
  }

  const tables = buildSchemaDocs(await loadDescriptions());
  const permissions = buildPermissionDocs();

  const modules = tables.reduce<Record<string, TableDoc[]>>((acc, t) => {
    (acc[t.module] ??= []).push(t);
    return acc;
  }, {});

  const tenantCount = tables.filter((t) => t.tenantScoped).length;
  const undocumented = tables.filter(
    (t) => !t.description && t.module !== PLATFORM_MODULE,
  ).length;
  const onPaper = INVARIANTS.filter(
    (i) => i.enforcement === "paper",
  ).length;

  return (
    <div className="reg">
      <div className="reg__inner">
        <header className="reg__masthead">
          <p className="reg__eyebrow">Developer portal · reference</p>
          <h1 className="reg__title">Data model</h1>
          <p className="reg__standfirst">
            Tables, columns, keys and indexes are read from the schema in the
            code. Descriptions come from the database&apos;s own comments. The
            grouping into modules is a hand-kept list, and a test fails if a
            table is missing from it. Notes on tables with special isolation are
            written by hand. Not shown here: row-level security policies,
            triggers and functions; those are in the <code>drizzle/</code>{" "}
            migrations. The reasoning and the findings log are in{" "}
            <code>docs/schema-design.md</code>.
          </p>
          <p className="reg__counts">
            <span>
              <b>{tables.length}</b> tables
            </span>
            <span>
              <b>{tenantCount}</b> with organization_id
            </span>
            <span>
              <b>{onPaper}</b> rules rely on review
            </span>
            {undocumented > 0 && (
              <span>
                <b>{undocumented}</b> undescribed
              </span>
            )}
            <span>
              <a href="/developer/schema.json">schema.json</a>
            </span>
          </p>
          <div className="reg__provenance">
            <ProvenanceLabel kind="generated" />
          </div>
          <p className="reg__legend">
            A filled dot marks a table with an <code>organization_id</code>{" "}
            column; a hollow dot marks one without.
          </p>
        </header>

        <TableFilter total={tables.length} />

        {Object.entries(modules).map(([module, moduleTables]) => {
          const slug = moduleSlug(module);
          const isPlatform = module === PLATFORM_MODULE;
          return (
            <section className="reg__module" data-section key={module}>
              <div className="reg__moduleHead">
                <h2 className="reg__moduleTitle">{module}</h2>
                <span className="reg__moduleMeta">
                  {moduleTables.length} tables
                </span>
                {!isPlatform && (
                  <Link
                    className="reg__diagramLink"
                    href={`/developer/erd/${slug}`}
                  >
                    Diagram →
                  </Link>
                )}
              </div>

              <ul className="reg__list">
                {moduleTables.map((t) => (
                  <li
                    key={t.name}
                    data-haystack={`${t.name} ${t.description ?? ""} ${t.columns
                      .map((c) => `${c.name} ${c.description ?? ""}`)
                      .join(" ")}`.toLowerCase()}
                  >
                    <Link
                      className="reg__row"
                      href={`/developer/tables/${t.name}`}
                    >
                      <span className="reg__rowName">{t.name}</span>
                      <span className="reg__rowSummary">
                        {summarize(t.description) || <em>No description yet</em>}
                      </span>
                      <span className="reg__rowMeta">
                        {t.columns.length} col
                        <span
                          className={`reg__dot ${
                            t.tenantScoped
                              ? "reg__dot--rls"
                              : "reg__dot--global"
                          }`}
                          aria-hidden
                        />
                        <span className="sr-only">
                          {t.tenantScoped
                            ? "has organization_id"
                            : "no organization_id"}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section className="reg__module">
          <div className="reg__moduleHead">
            <h2 className="reg__moduleTitle">The rules the system relies on</h2>
            <span className="reg__moduleMeta">{INVARIANTS.length} rules</span>
            <ProvenanceLabel kind="hand" />
          </div>
          <p className="reg__note">
            Rules marked <span className="reg__tag reg__tag--paper">paper</span>{" "}
            are the ones to watch: nothing in the database stops a violation, so
            review catches it. Some also have a source-scan check, which the
            rule&apos;s text names. A test checks that every rule heading in
            CLAUDE.md has an entry here; the wording of each entry is written
            by hand.
          </p>
          <ul className="reg__list">
            {INVARIANTS.map((inv) => (
              <li key={inv.title}>
                <div className="reg__row reg__row--static">
                  <span className="reg__rowName reg__rowName--prose">
                    {inv.title}
                  </span>
                  <span className="reg__rowSummary">{inv.detail}</span>
                  <span className="reg__rowMeta">
                    <span
                      className={`reg__tag ${
                        inv.enforcement === "paper"
                          ? "reg__tag--paper"
                          : "reg__tag--machine"
                      }`}
                    >
                      {inv.enforcement}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="reg__module">
          <div className="reg__moduleHead">
            <h2 className="reg__moduleTitle">Platform permissions</h2>
            <span className="reg__moduleMeta">{permissions.length} keys</span>
            <ProvenanceLabel kind="generated" />
          </div>
          <p className="reg__note">
            Governs the <code>/admin</code> shell only, and is frozen.
            Church-facing authorization is a separate scope, resolved per
            organization and per date by{" "}
            <code>presby_effective_permissions()</code>.
          </p>
          <ul className="reg__list">
            {permissions.map((p) => (
              <li key={p.key}>
                <div className="reg__row reg__row--static">
                  <span className="reg__rowName">{p.key}</span>
                  <span className="reg__rowSummary">{p.description}</span>
                  <span className="reg__rowMeta">{p.category}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
