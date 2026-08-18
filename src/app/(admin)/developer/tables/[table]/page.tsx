import Link from "next/link";
import { notFound } from "next/navigation";
import {
  buildSchemaDocs,
  loadDescriptions,
  moduleSlug,
} from "@/lib/dev-docs";
import { requirePlatformAdmin } from "../../guard";
import "../../developer.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ table: string }>;
}) {
  const { table } = await params;
  return { title: table };
}

/**
 * One table, in full. A real route so it can be linked in a PR or a ticket —
 * "see /developer/tables/roll_actions" is a better review comment than
 * "expand the fourth entry".
 */
export default async function TableDetail({
  params,
}: {
  params: Promise<{ table: string }>;
}) {
  const { table } = await params;
  await requirePlatformAdmin(`/developer/tables/${table}`);

  const tables = buildSchemaDocs(await loadDescriptions());
  const t = tables.find((x) => x.name === table);
  if (!t) notFound();

  // Which tables point AT this one. Knowing what depends on a table is most of
  // what a reviewer wants before changing it, and it is not visible from the
  // table's own foreign keys.
  const referencedBy = tables
    .filter((x) => x.foreignKeys.some((fk) => fk.foreignTable === t.name))
    .map((x) => x.name);

  return (
    <div className="reg">
      <div className="reg__inner">
        <nav className="reg__crumbs">
          <Link href="/developer">Data model</Link>
          <span aria-hidden>/</span>
          <Link href={`/developer/erd/${moduleSlug(t.module)}`}>{t.module}</Link>
        </nav>

        <header className="reg__masthead">
          <p className="reg__eyebrow">
            {t.tenantScoped ? "tenant-scoped · rls enforced" : "global · not tenant-isolated"}
          </p>
          <h1 className="reg__title reg__title--mono">{t.name}</h1>
          {t.description ? (
            <p className="reg__standfirst reg__standfirst--lead">
              {t.description}
            </p>
          ) : (
            <p className="reg__standfirst">
              <em>
                No description. Add one with{" "}
                <code>COMMENT ON TABLE {t.name} IS &apos;…&apos;</code>.
              </em>
            </p>
          )}
          <p className="reg__counts">
            <span>
              <b>{t.columns.length}</b> columns
            </span>
            <span>
              <b>{t.foreignKeys.length}</b> references out
            </span>
            <span>
              <b>{referencedBy.length}</b> in
            </span>
          </p>
        </header>

        {t.isolationNote && (
          <div className="reg__callout">
            <b>Isolation exception</b>
            {t.isolationNote}
          </div>
        )}

        <section className="reg__module">
          <div className="reg__moduleHead">
            <h2 className="reg__moduleTitle">Columns</h2>
          </div>
          <div className="reg__cols">
            <table>
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Rules</th>
                  <th>What it is for</th>
                </tr>
              </thead>
              <tbody>
                {t.columns.map((c) => (
                  <tr key={c.name}>
                    <td
                      className={`reg__colName ${c.primaryKey ? "reg__pk" : ""}`}
                    >
                      {c.name}
                    </td>
                    <td className="reg__colType">{c.type}</td>
                    <td className="reg__colFlags">
                      {[
                        c.primaryKey && "pk",
                        c.notNull && "required",
                        c.hasDefault && "default",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="reg__colDesc">{c.description ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {(t.foreignKeys.length > 0 || referencedBy.length > 0) && (
          <section className="reg__module">
            <div className="reg__moduleHead">
              <h2 className="reg__moduleTitle">Relationships</h2>
            </div>
            <ul className="reg__list">
              {t.foreignKeys.map((fk) => (
                <li key={fk.name}>
                  <Link
                    className="reg__row"
                    href={`/developer/tables/${fk.foreignTable}`}
                  >
                    <span className="reg__rowName">{fk.foreignTable}</span>
                    <span className="reg__rowSummary">
                      via {fk.columns.join(", ")}
                    </span>
                    <span className="reg__rowMeta">references</span>
                  </Link>
                </li>
              ))}
              {referencedBy.map((name) => (
                <li key={`in-${name}`}>
                  <Link
                    className="reg__row"
                    href={`/developer/tables/${name}`}
                  >
                    <span className="reg__rowName">{name}</span>
                    <span className="reg__rowSummary">points at this table</span>
                    <span className="reg__rowMeta">referenced by</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {t.indexes.length > 0 && (
          <section className="reg__module">
            <div className="reg__moduleHead">
              <h2 className="reg__moduleTitle">Indexes</h2>
            </div>
            <ul className="reg__list">
              {t.indexes.map((idx) => (
                <li key={idx.name}>
                  <div className="reg__row reg__row--static">
                    <span className="reg__rowName">{idx.name}</span>
                    <span className="reg__rowSummary">
                      {idx.columns.join(", ")}
                    </span>
                    <span className="reg__rowMeta">
                      {idx.unique ? "unique" : "index"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
