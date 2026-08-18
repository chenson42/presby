import { db } from "@/lib/db";
import { featureFlags } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { toggleFlagAction } from "./actions";

export default async function FlagsPage() {
  const flags = await db
    .select()
    .from(featureFlags)
    .orderBy(asc(featureFlags.key));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Feature flags</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Environment-wide toggles. Distinct from role permissions: these gate
        whether a capability is even visible in this deployment, not who can
        use it.
      </p>
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2">Key</th>
            <th>Description</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {flags.map((f) => (
            <tr key={f.key} className="border-b border-border">
              <td className="py-3 font-mono text-xs">{f.key}</td>
              <td className="text-xs">{f.description ?? "—"}</td>
              <td>
                <span
                  className={
                    f.enabled
                      ? "rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-700 dark:text-green-300"
                      : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  }
                >
                  {f.enabled ? "on" : "off"}
                </span>
              </td>
              <td>
                <form action={toggleFlagAction}>
                  <input type="hidden" name="key" value={f.key} />
                  <button
                    type="submit"
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                  >
                    Toggle
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {flags.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                No flags yet. Add some in <code>scripts/seed.ts</code> or via SQL.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
