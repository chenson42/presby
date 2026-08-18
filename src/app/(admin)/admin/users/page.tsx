import { db } from "@/lib/db";
import { users, roles, userRoles } from "@/lib/db/schema";
import { desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import Link from "next/link";
import { assignRoleAction, removeRoleAction, unlockUserAction } from "./actions";
import { FormattedDate } from "@/components/shared/formatted-date";

const PAGE_SIZE = 25;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? 1));
  const offset = (page - 1) * PAGE_SIZE;

  const whereExpr = q
    ? or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`))
    : undefined;

  const [{ count: totalRaw }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(whereExpr);
  const total = Number(totalRaw);

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      twoFactorRequired: users.twoFactorRequired,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(whereExpr)
    .orderBy(desc(users.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const allRoles = await db
    .select({ id: roles.id, name: roles.name, displayName: roles.displayName })
    .from(roles)
    .orderBy(roles.sortOrder);

  const rolesByUser = new Map<string, string[]>();
  if (rows.length > 0) {
    const userIds = rows.map((r) => r.id);
    const ur = await db
      .select({ userId: userRoles.userId, roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(inArray(userRoles.userId, userIds));
    for (const row of ur) {
      const list = rolesByUser.get(row.userId) ?? [];
      list.push(row.roleName);
      rolesByUser.set(row.userId, list);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const buildHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (nextPage > 1) params.set("page", String(nextPage));
    const s = params.toString();
    return s ? `/admin/users?${s}` : "/admin/users";
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Assign roles to users. Admins receive every feature automatically.
      </p>

      <form className="mt-6 flex gap-2" action="/admin/users" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name or email"
          className="w-72 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Search
        </button>
        {q && (
          <Link
            href="/admin/users"
            className="text-sm text-muted-foreground underline self-center"
          >
            Clear
          </Link>
        )}
      </form>

      <p className="mt-4 text-xs text-muted-foreground">
        {total} user{total === 1 ? "" : "s"} · page {page} of {totalPages}
      </p>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2">User</th>
            <th>Roles</th>
            <th>Last login</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const userRoleList = rolesByUser.get(u.id) ?? [];
            return (
              <tr key={u.id} className="border-b border-border">
                <td className="py-3">
                  <Link href={`/admin/users/${u.id}`} className="hover:underline">
                    <div className="font-medium">{u.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </Link>
                  {!u.twoFactorRequired && (
                    <span className="mt-1 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                      2FA exempt
                    </span>
                  )}
                  {u.lockedUntil && u.lockedUntil > new Date() && (
                    <>
                      <span className="mt-1 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                        Locked until{" "}
                        <FormattedDate value={u.lockedUntil} mode="datetime" />
                      </span>
                      <form
                        action={async (fd: FormData) => {
                          "use server";
                          await unlockUserAction({ userId: fd.get("userId") as string });
                        }}
                        className="mt-1"
                      >
                        <input type="hidden" name="userId" value={u.id} />
                        <button
                          type="submit"
                          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                        >
                          Unlock
                        </button>
                      </form>
                    </>
                  )}
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {userRoleList.map((r) => (
                      <form key={r} action={removeRoleAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="roleName" value={r} />
                        <button
                          type="submit"
                          className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-red-500/10"
                          title="Remove role"
                        >
                          {r} ×
                        </button>
                      </form>
                    ))}
                  </div>
                </td>
                <td className="text-xs text-muted-foreground">
                  {u.lastLoginAt ? <FormattedDate value={u.lastLoginAt} mode="datetime" /> : "—"}
                </td>
                <td>{u.isActive ? "yes" : "no"}</td>
                <td>
                  <form action={assignRoleAction} className="flex gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <select
                      name="roleId"
                      className="rounded border border-border bg-background px-2 py-1 text-xs"
                    >
                      {allRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.displayName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded bg-foreground px-2 py-1 text-xs text-background"
                    >
                      Add
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                {q ? "No users match that search." : "No users yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={buildHref(page - 1)} className="underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {page < totalPages ? (
            <Link href={buildHref(page + 1)} className="underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
