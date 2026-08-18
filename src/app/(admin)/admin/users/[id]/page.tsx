import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { eq, and, isNull, count } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users, userTotp, userTotpRecoveryCodes } from "@/lib/db/schema";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { TwoFactorCard } from "./two-factor-card";
import { DeactivateCard } from "./deactivate-card";
import { FormattedDate } from "@/components/shared/formatted-date";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!hasFeature(session.user.features, FEATURES.ADMIN_USERS)) {
    redirect("/access-pending");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      twoFactorRequired: true,
      createdAt: true,
    },
    with: {
      totp: {
        columns: { enrolledAt: true, lastUsedAt: true },
      },
    },
  });

  if (!user) notFound();

  const [{ unusedCount }] = await db
    .select({ unusedCount: count() })
    .from(userTotpRecoveryCodes)
    .where(
      and(
        eq(userTotpRecoveryCodes.userId, id),
        isNull(userTotpRecoveryCodes.usedAt),
      ),
    );

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <Link
          href="/admin/users"
          className="text-sm text-muted-foreground underline"
        >
          ← Back to users
        </Link>
      </div>

      <h1 className="text-2xl font-semibold">{user.name ?? user.email}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Account created <FormattedDate value={user.createdAt} mode="date" />.{" "}
        {user.isActive ? "Active" : "Inactive"}.
      </p>

      <div className="mt-8 space-y-6">
        <DeactivateCard
          userId={user.id}
          isActive={user.isActive}
          isSelf={session.user.id === user.id}
        />
        <TwoFactorCard
          userId={user.id}
          twoFactorRequired={user.twoFactorRequired}
          enrolled={!!user.totp}
          enrolledAt={user.totp?.enrolledAt ?? null}
          unusedRecoveryCodeCount={unusedCount}
          isSelf={session.user.id === user.id}
        />
      </div>
    </div>
  );
}
