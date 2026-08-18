import Link from "next/link";
import {
  buildSchemaDocs,
  buildPermissionDocs,
  loadDescriptions,
  moduleSlug,
  summarize,
  INVARIANTS,
  type TableDoc,
} from "@/lib/dev-docs";
import { requirePlatformAdmin } from "./guard";
import { TableFilter } from "./table-filter";
import "./developer.css";

export const metadata = {
  title: "Data model",
  description: "Generated technical reference for the presby schema.",
};

/**
 * /developer — an index, not a document.
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
export default async function DeveloperIndex() {
  await requirePlatformAdmin("/developer");

  const tables = buildSchemaDocs(await loadDescriptions());
  const permissions = buildPermissionDocs();

  const modules = tables.reduce<Record<string, TableDoc[]>>((acc, t) => {
    (acc[t.module] ??= []).push(t);
    return acc;
  }, {});

  const tenantCount = tables.filter((t) => t.tenantScoped).length;
  const undocumented = tables.filter(
    (t) => !t.description && t.module !== "platform (from starter)",
  ).length;
  const onPaper = INVARIANTS.filter(
    (i) => i.enforcement === "documented",
  ).length;

  return (
    <div className="reg">
      <div className="reg__inner">
        <header className="reg__masthead">
          <p className="reg__eyebrow">presby · technical reference</p>
          <h1 className="reg__title">The data model</h1>
          <p className="reg__standfirst">
            Generated on each request from <code>src/lib/db/schema</code> and
            Postgres <code>COMMENT ON</code>, so it cannot drift from what is
            deployed. Rationale and the review-findings log live in{" "}
            <code>docs/schema-design.md</code>.
          </p>
          <p className="reg__counts">
            <span>
              <b>{tables.length}</b> tables
            </span>
            <span>
              <b>{tenantCount}</b> tenant-scoped
            </span>
            <span>
              <b>{onPaper}</b> rules unenforced
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
        </header>

        <TableFilter total={tables.length} />

        {Object.entries(modules).map(([module, moduleTables]) => {
          const slug = moduleSlug(module);
          const isPlatform = module === "platform (from starter)";
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
                        {summarize(t.description) || <em>No description</em>}
                      </span>
                      <span className="reg__rowMeta">
                        {t.columns.length} col
                        <span
                          className={`reg__dot ${
                            t.tenantScoped
                              ? "reg__dot--rls"
                              : "reg__dot--global"
                          }`}
                          title={
                            t.tenantScoped
                              ? "Tenant-scoped: row-level security applies"
                              : "Global: not tenant-isolated"
                          }
                        />
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
            <h2 className="reg__moduleTitle">What the schema guarantees</h2>
            <span className="reg__moduleMeta">{INVARIANTS.length} rules</span>
          </div>
          <p className="reg__note">
            Rules marked <span className="reg__tag reg__tag--paper">paper</span>{" "}
            are the ones to watch: the schema permits a violation and only
            review will catch it.
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
                        inv.enforcement === "documented"
                          ? "reg__tag--paper"
                          : "reg__tag--machine"
                      }`}
                    >
                      {inv.enforcement === "documented"
                        ? "paper"
                        : inv.enforcement}
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
