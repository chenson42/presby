import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  buildSchemaDocs,
  buildPermissionDocs,
  buildErd,
  loadDescriptions,
  INVARIANTS,
  type TableDoc,
} from "@/lib/dev-docs";
import { TableFilter } from "./table-filter";
import "./developer.css";

export const metadata = {
  title: "Data model",
  description: "Generated technical reference for the presby schema.",
};

/**
 * /developer — the technical reference, for developers reviewing the system.
 *
 * Generated on every request from the Drizzle schema and from Postgres COMMENT
 * ON, so it cannot drift from what is actually deployed.
 *
 * Set as a register, because that is what the system keeps: description leads,
 * columns follow, rules separate entries, and the margin column stamps how each
 * guarantee is enforced. The distinction between a rule the database enforces
 * and one that only review catches is the single most useful thing a reviewer
 * can learn here, so it is the one thing given colour.
 */
export default async function DeveloperPage() {
  const session = await cachedAuth();
  if (!session?.user) redirect("/signin?callbackUrl=/developer");

  // Read from the database rather than the session so revoking platform admin
  // takes effect immediately instead of at the next token refresh.
  const [me] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me?.isPlatformAdmin) redirect("/home");

  const descriptions = await loadDescriptions();
  const tables = buildSchemaDocs(descriptions);
  const permissions = buildPermissionDocs();

  const modules = tables.reduce<Record<string, TableDoc[]>>((acc, t) => {
    (acc[t.module] ??= []).push(t);
    return acc;
  }, {});

  const tenantCount = tables.filter((t) => t.tenantScoped).length;
  const documented = tables.filter((t) => t.description).length;

  return (
    <div className="reg">
      <div className="reg__inner">
        <header className="reg__masthead">
          <p className="reg__eyebrow">presby · technical reference</p>
          <h1 className="reg__title">The data model</h1>
          <p className="reg__standfirst">
            Generated on each request from <code>src/lib/db/schema</code> and
            from Postgres <code>COMMENT ON</code>. Nothing here is written by
            hand, so it cannot drift from what is deployed. Design rationale and
            the review-findings log live in <code>docs/schema-design.md</code>.
          </p>
          <p className="reg__counts">
            <span>
              <b>{tables.length}</b> tables
            </span>
            <span>
              <b>{tenantCount}</b> tenant-scoped
            </span>
            <span>
              <b>{documented}</b> described
            </span>
            <span>
              <a href="/developer/schema.json">schema.json</a>
            </span>
          </p>
        </header>

        <section className="reg__section" aria-labelledby="inv">
          <div className="reg__sectionHead">
            <span className="reg__cite">§ I</span>
            <h2 className="reg__sectionTitle" id="inv">
              What the schema guarantees
            </h2>
          </div>
          <p className="reg__desc" style={{ padding: "1rem 0 0" }}>
            Each rule below is either enforced by the database, enforced by a
            trigger, or <strong>only written down</strong>. The last kind is the
            one worth your attention: the schema permits a violation and nothing
            but review will catch it.
          </p>
          {INVARIANTS.map((inv) => (
            <div className="reg__entry" key={inv.title}>
              <div className="reg__margin">
                <span
                  className={`reg__stamp ${
                    inv.enforcement === "documented"
                      ? "reg__stamp--paper"
                      : "reg__stamp--machine"
                  }`}
                >
                  {inv.enforcement}
                </span>
              </div>
              <div>
                <p className="reg__name" style={{ fontFamily: "inherit" }}>
                  {inv.title}
                </p>
                <p className="reg__desc">{inv.detail}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="reg__section" aria-labelledby="sch">
          <div className="reg__sectionHead">
            <span className="reg__cite">§ II</span>
            <h2 className="reg__sectionTitle" id="sch">
              Tables
            </h2>
          </div>
          <TableFilter total={tables.length} />

          {Object.entries(modules).map(([module, moduleTables], i) => (
            <div key={module} data-section className="reg__module">
              <div className="reg__sectionHead" style={{ marginTop: "2.5rem" }}>
                <span className="reg__cite">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="reg__sectionTitle" style={{ fontSize: "1.1rem" }}>
                  {module}
                </h3>
              </div>

              {module !== "platform (from starter)" && (
                <div className="reg__entry">
                  <div className="reg__margin">relations</div>
                  <details className="reg__body">
                    <summary>
                      <span className="reg__name">Entity diagram</span>
                      <span className="reg__meta">mermaid</span>
                    </summary>
                    <pre className="reg__diagram">
                      <code>{buildErd(tables, module)}</code>
                    </pre>
                  </details>
                </div>
              )}

              {moduleTables.map((t) => (
                <div
                  className="reg__entry"
                  key={t.name}
                  data-haystack={`${t.name} ${t.description ?? ""} ${t.columns
                    .map((c) => `${c.name} ${c.description ?? ""}`)
                    .join(" ")}`.toLowerCase()}
                >
                  <div className="reg__margin">
                    {t.tenantScoped ? (
                      <span className="reg__stamp reg__stamp--machine">
                        rls
                      </span>
                    ) : (
                      <span className="reg__stamp reg__stamp--paper">
                        global
                      </span>
                    )}
                  </div>

                  <details className="reg__body">
                    <summary>
                      <span className="reg__name">{t.name}</span>
                      <span className="reg__meta">
                        {t.columns.length} columns
                        {t.foreignKeys.length > 0 &&
                          ` · ${t.foreignKeys.length} refs`}
                      </span>
                    </summary>

                    {t.description ? (
                      <p className="reg__desc">{t.description}</p>
                    ) : (
                      <p className="reg__desc">
                        <em>
                          No description. Add one with{" "}
                          <code>COMMENT ON TABLE {t.name}</code>.
                        </em>
                      </p>
                    )}

                    {t.isolationNote && (
                      <div className="reg__isolation">
                        <b>Isolation exception</b>
                        {t.isolationNote}
                      </div>
                    )}

                    {t.notes.map((n) => (
                      <div className="reg__isolation" key={n}>
                        <b>Note</b>
                        {n}
                      </div>
                    ))}

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
                                className={`reg__colName ${
                                  c.primaryKey ? "reg__pk" : ""
                                }`}
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
                              <td className="reg__colDesc">
                                {c.description ?? ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {t.foreignKeys.length > 0 && (
                      <p className="reg__rel">
                        {t.foreignKeys.map((fk) => (
                          <span key={fk.name}>
                            {fk.columns.join(", ")} → <b>{fk.foreignTable}</b>
                            {"   "}
                          </span>
                        ))}
                      </p>
                    )}
                  </details>
                </div>
              ))}
            </div>
          ))}
        </section>

        <section className="reg__section" aria-labelledby="perm">
          <div className="reg__sectionHead">
            <span className="reg__cite">§ III</span>
            <h2 className="reg__sectionTitle" id="perm">
              Platform permissions
            </h2>
          </div>
          <p className="reg__desc" style={{ padding: "1rem 0 0" }}>
            The catalog below governs the <code>/admin</code> shell only, and is
            frozen. Church-facing authorization is resolved per organization and
            per date by <code>presby_effective_permissions()</code>, which is a
            separate scope on purpose: holding every platform feature grants
            nothing inside a congregation, because the tenant connection cannot
            bypass row-level security.
          </p>
          {permissions.map((p) => (
            <div className="reg__entry" key={p.key}>
              <div className="reg__margin">{p.category}</div>
              <div>
                <p className="reg__name">{p.key}</p>
                <p className="reg__desc">{p.description}</p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
