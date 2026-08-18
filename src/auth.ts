import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
  userRoles,
  roles,
  roleFeatures,
  features,
} from "@/lib/db/schema";
import { authConfig } from "@/lib/auth/config";
import { evaluateSignIn } from "@/lib/auth/sign-in-gate";
import { ADMIN_ROLE, FEATURES, MEMBER_ROLE } from "@/lib/permissions";
import { getRequestIp } from "@/lib/request-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  checkLockout,
  LOCKOUT_THRESHOLD,
  LOCKOUT_DURATION_SECONDS,
} from "@/lib/auth/lockout";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  isLocalLoginEnabled,
  computeEffectiveTwoFactor,
} from "@/lib/auth/local-login";
import { verifyTurnstile } from "@/lib/turnstile";

const INITIAL_ADMIN_EMAILS = (process.env.INITIAL_ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const FEATURE_KEYS = Object.values(FEATURES) as string[];

/**
 * Bind a freshly-signed-in user to a default role if they have none.
 *
 * Two reasons we do this here rather than relying on `events.createUser`:
 *
 *   1. `events.createUser` is fire-and-forget — the JWT callback can run
 *      before its async role insert completes, leaving the user with an
 *      empty `roles` array on first request.
 *   2. Credentials users skip the adapter entirely, so `events.createUser`
 *      never fires for them at all (this is why the seed script binds the
 *      local admin's role directly).
 *
 * Idempotent: returns early if the user already holds at least one role.
 */
async function ensureDefaultRole(
  userId: string,
  email: string | null,
): Promise<void> {
  const existing = await db.query.userRoles.findFirst({
    where: eq(userRoles.userId, userId),
  });
  if (existing) return;
  const desiredRoleName = email && INITIAL_ADMIN_EMAILS.includes(email.toLowerCase())
    ? ADMIN_ROLE
    : MEMBER_ROLE;
  const role = await db.query.roles.findFirst({
    where: eq(roles.name, desiredRoleName),
  });
  if (!role) return;
  await db
    .insert(userRoles)
    .values({ userId, roleId: role.id })
    .onConflictDoNothing();
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Google verifies email ownership at sign-in, so linking an existing
      // user record by email is safe with Google alone. If a fork adds a
      // second OAuth provider (GitHub, Microsoft, etc.) that does NOT verify
      // email, set this to `false` or the second provider can impersonate a
      // Google user by claiming their email.
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      name: "Email + Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // NextAuth 5 beta strips undeclared fields before authorize() is called.
        // type: "hidden" suppresses this field in any auto-generated sign-in form.
        turnstileToken: { label: "Turnstile Token", type: "hidden" },
      },
      async authorize(credentials, request) {
        const email = (credentials?.email as string | undefined)?.toLowerCase();
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        // Step 0: auth.local_login flag check — BEFORE rate limit so a
        // disabled-flag rejection does not consume rate-limit budget on a
        // permanently-blocked code path. Fail-open: missing row or DB error
        // → allow credentials through (DECISION-026).
        const localLoginEnabled = await isLocalLoginEnabled();
        if (!localLoginEnabled) return null;

        // Extract IP early — shared by step 0.5 (Turnstile) and step 1 (rate limit).
        // NextAuth 5 beta passes the original Request as the second arg.
        // If headers are unavailable the key degrades to "unknown" — still a
        // meaningful per-email rate limit.
        const ip = getRequestIp(
          (request as Request | undefined)?.headers ?? new Headers(),
        );

        // Step 0.5: Turnstile verification — BEFORE rate limit so bot traffic
        // does not consume rate-limit budget. Fail-open when TURNSTILE_SECRET_KEY
        // is unset (the starter default, DECISION-026). Surfaces to the user as
        // CredentialsSignin — no leakage about why the check failed.
        const turnstileOk = await verifyTurnstile(
          credentials?.turnstileToken as string | undefined,
          ip,
        );
        if (!turnstileOk) return null;

        // Rate limit: 5/min keyed by ip:email composite.
        const limited = await checkRateLimit(
          `signin:${ip ?? "unknown"}:${email}`,
          { max: 5, windowSeconds: 60 },
          { userId: null, actor: email, reason: "credentials_signin" },
        );
        if (!limited.allowed) return null; // NextAuth surfaces CredentialsSignin

        const user = await db.query.users.findFirst({
          where: eq(users.email, email),
        });
        if (!user?.password || !user.isActive) return null;

        // Step 5: lockout check (credentials path only — see lockout.ts header).
        // Returns null via the same code path as wrong-password to prevent enumeration.
        const now = new Date();
        const lockStatus = checkLockout(user, now);
        if (lockStatus.locked) return null;

        // Step 5b: lock window has expired — reset the counter before calling bcrypt
        // so the user gets a fresh LOCKOUT_THRESHOLD window, not an immediate re-lock
        // on the first failure after expiry (Gap 2 fix; see lockout.ts LockoutState.resetCounter).
        if (lockStatus.resetCounter) {
          await db
            .update(users)
            .set({ failedLoginAttempts: 0, lockedUntil: null })
            .where(eq(users.id, user.id));
        }

        const ok = await bcrypt.compare(password, user.password);

        if (!ok) {
          // Atomic conditional-increment. Single UPDATE avoids the SELECT-then-write
          // race that could cause both the lock set and the audit event to double-fire
          // under concurrent requests. See DECISION-025 and the Phase 3 design doc for
          // full SQL semantics. Untyped sql`` (no generic) is intentional — the type
          // parameter is unnecessary on .set() RHS expressions in Drizzle.
          const [updated] = await db
            .update(users)
            .set({
              failedLoginAttempts: sql`failed_login_attempts + 1`,
              lockedUntil: sql`
                CASE WHEN failed_login_attempts + 1 >= ${LOCKOUT_THRESHOLD}
                  THEN now() + make_interval(secs => ${LOCKOUT_DURATION_SECONDS})
                  ELSE locked_until
                END
              `,
            })
            .where(eq(users.id, user.id))
            .returning({
              failedLoginAttempts: users.failedLoginAttempts,
              lockedUntil: users.lockedUntil,
            });

          // The account was not locked when we reached bcrypt (checkLockout above).
          // Any non-null lockedUntil in RETURNING means the lock was set right now.
          if (updated?.lockedUntil != null) {
            void recordAudit({
              action: AUDIT_ACTIONS.USER_ACCOUNT_LOCKED,
              actor: { userId: user.id, email: user.email },
              resourceType: "user",
              resourceId: user.id,
              metadata: {
                failedAttempts: LOCKOUT_THRESHOLD,
                lockedUntilEpochMs: updated.lockedUntil.getTime(),
              },
            });
          }
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      // Delegate to the extracted gate so all branches are unit-testable.
      // See src/lib/auth/sign-in-gate.ts and DECISION-015 for rationale:
      //   - credentials → true unconditionally (authorize() already checked isActive)
      //   - OAuth, no row → true (adapter will create the user row after this)
      //   - OAuth, isActive=false → false (soft-deactivation block)
      //   - OAuth, no email → false (fail-safe)
      return evaluateSignIn(
        account?.provider ?? "credentials",
        user,
        (email) =>
          db.query.users
            .findFirst({
              where: eq(users.email, email),
              columns: { isActive: true },
            })
            .then((row) => row ?? null),
      );
    },
    // The `session` callback lives in the shared authConfig so the edge
    // runtime (proxy.ts) sees the same projection.
    async jwt({ token, user, trigger, session }) {
      // `user` is only present on the initial sign-in (Google callback or a
      // successful Credentials authorize). Subsequent requests carry the JWT
      // cookie only, so this block runs exactly once per session.
      if (user?.id) {
        token.sub = user.id;
        token.twoFactorVerified = false;
        // Force a roles refresh on first sign-in. NextAuth's `createUser`
        // event runs fire-and-forget for OAuth users (the JWT callback can
        // race ahead of it), and Credentials sign-ins never fire it at all,
        // so we ensure the default role assignment + role load happen here
        // synchronously below.
        token.roles = undefined;
        await ensureDefaultRole(user.id, user.email ?? null);
        await db
          .update(users)
          .set({ lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null })
          .where(eq(users.id, user.id));
      }

      // Server-action-triggered updates (e.g. 2FA verified, role assigned)
      // call `unstable_update`; we merge the partial session payload back into
      // the token here so subsequent requests see the new state.
      if (trigger === "update" && session?.user) {
        if (typeof session.user.twoFactorVerified === "boolean") {
          token.twoFactorVerified = session.user.twoFactorVerified;
        }
        if (Array.isArray(session.user.roles)) {
          token.roles = session.user.roles;
        }
        if (Array.isArray(session.user.features)) {
          token.features = session.user.features;
        }
      }

      // Stale-JWT defense + role refresh.
      //
      // We hit the DB on every authenticated request to verify the user row
      // still exists and is active. That's one cheap SELECT, and it's the
      // only thing standing between a deleted/deactivated user and a still-
      // valid signed cookie. For role + feature changes to apply mid-session,
      // call `unstable_update({})` from the mutating action; this re-runs
      // the role lookup below.
      if (!token.sub) return token;

      const userId = token.sub;
      const dbUser = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { isActive: true, twoFactorRequired: true, email: true },
      });
      if (!dbUser || !dbUser.isActive) {
        // Row vanished or got deactivated. Returning an empty token signs
        // the user out on the next request.
        return {};
      }
      token.isActive = dbUser.isActive;
      // Effective twoFactorRequired: raw column value AND the org-level
      // auth.require_2fa master switch. Short-circuits when column is false
      // (no flag read needed). Falls back to raw column on DB error so a DB
      // blip does not accidentally ungate TOTP-required users. See DECISION-026.
      token.twoFactorRequired = await computeEffectiveTwoFactor(
        dbUser.twoFactorRequired,
      );
      if (dbUser.email) token.email = dbUser.email;

      const needsRoleRefresh = !token.roles || trigger === "update" || !!user;
      if (needsRoleRefresh) {
        const roleRows = await db
          .select({ name: roles.name })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .where(eq(userRoles.userId, userId))
          .orderBy(roles.sortOrder);
        const roleNames = roleRows.map((r) => r.name);
        token.roles = roleNames;

        if (roleNames.includes(ADMIN_ROLE)) {
          // Admins receive every key in the static FEATURE_CATALOG, not every
          // row in the `features` table. The DB is *not* the source of truth
          // for the admin grant — the code is. This protects against stale
          // rows leaking in and missing rows leaving admins under-privileged.
          token.features = FEATURE_KEYS;
        } else if (roleNames.length > 0) {
          const featRows = await db
            .selectDistinct({ key: features.key })
            .from(roleFeatures)
            .innerJoin(roles, eq(roleFeatures.roleId, roles.id))
            .innerJoin(userRoles, eq(userRoles.roleId, roles.id))
            .innerJoin(features, eq(roleFeatures.featureKey, features.key))
            .where(eq(userRoles.userId, userId));
          token.features = featRows.map((f) => f.key);
        } else {
          token.features = [];
        }
      }
      return token;
    },
  },
});
