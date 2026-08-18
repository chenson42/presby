import { redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  buildSchemaDocs,
  buildPermissionDocs,
  buildErd,
  INVARIANTS,
  type TableDoc,
} from "@/lib/dev-docs";

export const metadata = {
  title: "Developer reference",
  description: "Generated technical reference for the presby schema.",
};

/**
 * /developer — the self-documenting technical reference.
 *
 * Generated from the Drizzle schema on every request, so it cannot rot. Serves
 * three jobs beyond developer convenience:
 *
 *   1. The permissions explainability surface. "Why can Jane see the donor
 *      list" needs an answer, and a union-based resolver is unauditable within
 *      a year without one.
 *   2. The AI support worker's map of the system. /developer/schema.json is
 *      generated from the same source as this page, so they cannot disagree.
 *   3. Open-source onboarding, since there is no tribal knowledge to lean on.
 *
 * Gated on users.is_platform_admin for now. When tenant-scoped roles land this
 * splits in two: a platform tier that sees everything structural, and a tenant
 * tier that sees only its own org's roles and config.
 */
export default async function DeveloperPage() {
  const session = await cachedAuth();
  if (!session?.user) redirect("/signin?callbackUrl=/developer");

  // TODO(authz): swap for a `system.developer` permission once the presby role
  // model replaces the starter's. Until then this is platform-admin only —
  // deliberately the stricter of the two options.
  //
  // Read from the database rather than the session so revoking platform admin
  // takes effect immediately instead of at the next token refresh.
  const [me] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me?.isPlatformAdmin) redirect("/home");

  const tables = buildSchemaDocs();
  const permissions = buildPermissionDocs();

  const modules = tables.reduce<Record<string, TableDoc[]>>((acc, t) => {
    (acc[t.module] ??= []).push(t);
    return acc;
  }, {});

  const tenantCount = tables.filter((t) => t.tenantScoped).length;

  return (
    <div className="mx-auto max-w-5xl space-y-10 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Developer reference</h1>
        <p className="text-sm text-muted-foreground">
          Generated from <code>src/lib/db/schema</code> at request time. Nothing
          here is hand-maintained. Design rationale and the review-findings log
          live in <code>docs/schema-design.md</code>.
        </p>
        <p className="text-sm text-muted-foreground">
          {tables.length} tables, {tenantCount} tenant-scoped ·{" "}
          <Link href="/developer/schema.json" className="underline">
            JSON
          </Link>
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Invariants</h2>
        <p className="text-sm text-muted-foreground">
          What the schema exists to enforce. <strong>Documented</strong> means
          the schema permits a violation and only review catches it.
        </p>
        <ul className="space-y-2">
          {INVARIANTS.map((inv) => (
            <li key={inv.title} className="rounded border border-border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{inv.title}</span>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs ${
                    inv.enforcement === "documented"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                      : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  }`}
                >
                  {inv.enforcement}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{inv.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Schema</h2>
        {Object.entries(modules).map(([module, moduleTables]) => (
          <div key={module} className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {module}
            </h3>

            {module !== "platform (from starter)" && (
              <details className="rounded border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  ER diagram{" "}
                  <span className="text-xs text-muted-foreground">
                    (mermaid)
                  </span>
                </summary>
                <pre className="mt-3 overflow-x-auto rounded bg-muted/50 p-3 text-xs">
                  <code>{buildErd(tables, module)}</code>
                </pre>
              </details>
            )}
            {moduleTables.map((t) => (
              <details
                key={t.name}
                className="rounded border border-border p-3"
              >
                <summary className="cursor-pointer text-sm font-medium">
                  <code>{t.name}</code>{" "}
                  <span className="text-xs text-muted-foreground">
                    {t.columns.length} columns
                    {t.tenantScoped ? " · tenant-scoped" : ""}
                  </span>
                </summary>

                {t.notes.length > 0 && (
                  <ul className="mt-3 space-y-1 border-l-2 border-amber-500/40 pl-3">
                    {t.notes.map((n) => (
                      <li key={n} className="text-xs text-muted-foreground">
                        {n}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-4">Column</th>
                        <th className="py-1 pr-4">Type</th>
                        <th className="py-1">Constraints</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.columns.map((c) => (
                        <tr key={c.name} className="border-t border-border/50">
                          <td className="py-1 pr-4 font-mono">{c.name}</td>
                          <td className="py-1 pr-4 text-muted-foreground">
                            {c.type}
                          </td>
                          <td className="py-1 text-muted-foreground">
                            {[
                              c.primaryKey && "PK",
                              c.notNull && "not null",
                              c.hasDefault && "default",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {t.foreignKeys.length > 0 && (
                  <div className="mt-3 text-xs">
                    <span className="text-muted-foreground">
                      Foreign keys —{" "}
                    </span>
                    {t.foreignKeys.map((fk, i) => (
                      <span key={fk.name}>
                        {i > 0 && ", "}
                        <code>({fk.columns.join(", ")})</code> →{" "}
                        <code>{fk.foreignTable}</code>
                      </span>
                    ))}
                  </div>
                )}
              </details>
            ))}
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Permission catalog</h2>
        <p className="text-sm text-muted-foreground">
          Global and code-defined. Tenants compose roles from these keys but can
          never invent one, because a church-invented permission is a string
          nothing checks.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-4">Key</th>
                <th className="py-1 pr-4">Name</th>
                <th className="py-1">Category</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={p.key} className="border-t border-border/50">
                  <td className="py-1 pr-4 font-mono text-xs">{p.key}</td>
                  <td className="py-1 pr-4">{p.name}</td>
                  <td className="py-1 text-muted-foreground">{p.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
