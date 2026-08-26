import { db } from "@/lib/db";
import { users, roles, userRoles } from "@/lib/db/schema";
import { desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { assignRoleAction, removeRoleAction, unlockUserAction } from "./actions";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search by name or email"
          className="w-72"
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
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

      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Last login</TableHead>
            <TableHead>Active</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((u) => {
            const userRoleList = rolesByUser.get(u.id) ?? [];
            return (
              <TableRow key={u.id}>
                <TableCell className="whitespace-normal">
                  <Link href={`/admin/users/${u.id}`} className="hover:underline">
                    <div className="font-medium">{u.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </Link>
                  {!u.twoFactorRequired && (
                    <Badge
                      variant="outline"
                      className="mt-1 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    >
                      2FA exempt
                    </Badge>
                  )}
                  {u.lockedUntil && u.lockedUntil > new Date() && (
                    <>
                      <Badge
                        variant="outline"
                        className="mt-1 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      >
                        Locked until{" "}
                        <FormattedDate value={u.lockedUntil} mode="datetime" />
                      </Badge>
                      <form
                        action={async (fd: FormData) => {
                          "use server";
                          await unlockUserAction({ userId: fd.get("userId") as string });
                        }}
                        className="mt-1"
                      >
                        <input type="hidden" name="userId" value={u.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Unlock
                        </Button>
                      </form>
                    </>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap gap-1">
                    {userRoleList.map((r) => (
                      <form key={r} action={removeRoleAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="roleName" value={r} />
                        <Button type="submit" variant="outline" size="sm" title="Remove role">
                          {r} ×
                        </Button>
                      </form>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {u.lastLoginAt ? <FormattedDate value={u.lastLoginAt} mode="datetime" /> : "—"}
                </TableCell>
                <TableCell>{u.isActive ? "yes" : "no"}</TableCell>
                <TableCell>
                  <form action={assignRoleAction} className="flex gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <div className="relative">
                      <select
                        name="roleId"
                        aria-label="Assign role"
                        className="appearance-none rounded border border-input bg-background py-1 pr-6 pl-2 text-xs"
                      >
                        {allRoles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.displayName}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        className="pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                    </div>
                    <Button type="submit" size="sm">
                      Add
                    </Button>
                  </form>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={5}
                className="py-6 text-center text-sm text-muted-foreground"
              >
                {q ? "No users match that search." : "No users yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

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
