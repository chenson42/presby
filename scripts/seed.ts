import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { and, eq, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "../src/lib/db/schema";
import { groupTypes } from "../src/lib/db/domain/groups";
import {
  ADMIN_ROLE,
  FEATURE_CATALOG,
  FEATURES,
  MEMBER_ROLE,
  SUPPORT_OPERATOR_ROLE,
} from "../src/lib/permissions";

if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL in .env.local before running the seed.");
}
if (!process.env.PLATFORM_DATABASE_URL) {
  throw new Error(
    "Set PLATFORM_DATABASE_URL in .env.local before running the seed — " +
      "seedGroupTypes() needs the RLS-bypassing platform connection (see " +
      "its own comment for why).",
  );
}

const initialAdmins = (process.env.INITIAL_ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (initialAdmins.length === 0) {
  console.warn(
    "[seed] INITIAL_ADMIN_EMAILS is empty — the first sign-in won't auto-receive the admin role. " +
      "Set a comma-separated list in .env.local (e.g. you@example.com,teammate@example.com) before signing in.",
  );
} else {
  console.log(`[seed] Will auto-admin on first sign-in: ${initialAdmins.join(", ")}`);
}

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql, { schema });

// RLS-bypassing connection (presby_platform role), used ONLY by
// seedGroupTypes() below — group_types is a FORCE-RLS tenant table
// (drizzle/0009_presby_rls.sql) whose tenant_isolation policy is
// `organization_id = presby_current_org()`. A platform-wide template row has
// `organization_id IS NULL`, and NULL never equals anything under standard
// SQL equality — not even under a matching org context — so `db` (the plain
// presby_app connection every other seed function here correctly uses) can
// NEVER insert one; confirmed by running this script against a real database
// before this comment was written (see work-log Phase 4 Implementer Notes).
const platformSql = neon(process.env.PLATFORM_DATABASE_URL);
const platformDb = drizzle(platformSql, { schema });

async function seedRoles() {
  const defs = [
    { name: ADMIN_ROLE, displayName: "Admin", isSystem: true, sortOrder: 0 },
    {
      name: SUPPORT_OPERATOR_ROLE,
      displayName: "Support Operator",
      isSystem: true,
      sortOrder: 50,
    },
    { name: MEMBER_ROLE, displayName: "Member", isSystem: true, sortOrder: 100 },
  ];
  for (const r of defs) {
    await db.insert(schema.roles).values(r).onConflictDoNothing();
  }
  console.log("seeded roles");
}

async function seedFeatures() {
  for (const f of FEATURE_CATALOG) {
    await db.insert(schema.features).values(f).onConflictDoNothing();
  }
  console.log(`seeded ${FEATURE_CATALOG.length} features`);
}

async function seedFlags() {
  const defaults = [
    {
      key: "demo.new_dashboard",
      description: "Demo flag wired into /admin to show the pattern.",
      enabled: false,
    },
    {
      key: "auth.local_login",
      // ON: credentials sign-in (email + password) is available. Seeded ON —
      // required for e2e global-setup (all three seeded users authenticate via
      // credentials). Turn OFF to make this deployment Google-OAuth-only;
      // authorize() rejects the credentials endpoint even if a POST is
      // crafted directly.
      description:
        "Enable email + password sign-in. OFF = OAuth-only; credentials endpoint is blocked.",
      enabled: true,
    },
    {
      key: "auth.require_2fa",
      // ON: effective twoFactorRequired = dbUser.twoFactorRequired AND this flag.
      // Seeded ON — required to keep the seeded MFA admin e2e test green (that
      // user has twoFactorRequired=true in DB; without this flag the proxy gate
      // does not fire). Turn OFF to globally disable forced 2FA regardless of
      // per-user column.
      description:
        "Org-level 2FA master switch. OFF = no user is TOTP-gated regardless of per-user column.",
      enabled: true,
    },
    {
      key: "ui.brand_theming",
      // ON: gates whether (org) actually EMITS a per-organization brand
      // (src/lib/brand/read-org-brand.ts) — never the /admin/organizations
      // write/preview path, which works regardless (DECISION-003: a flag
      // never gates a permission). Seeded ON — required for the e2e
      // visual-parity fixture (e2e-alpha carries a brand row; see
      // e2e/support/seed-orgs.ts) and matches this flag's own design intent
      // as a ROLLBACK lever: it starts on, and an operator turns it off if a
      // re-skin turns out unreadable for someone who cannot be seen in
      // advance. Turning it off does not touch any organization_brands row —
      // it is purely whether the per-org override is emitted.
      description:
        "Per-org brand emission in (org). OFF = every congregation renders the platform default regardless of what /admin/organizations has staged.",
      enabled: true,
    },
    {
      key: "org_portal.directory",
      // ON: /o/<slug>/directory is reachable at all. Checked bare, no
      // DECISION-026 fail-open wrapper — it's a toggle, not an auth path
      // (Phase 2, docs/work-log/2026-08-19-tenant-permissions-portal.md).
      // Never substitutes for directory.view: a member with the flag on and
      // no grant still sees the in-shell "you don't have permission" state,
      // not the directory itself (DECISION-003: a flag never gates a
      // permission). Seeded OFF — the first real tenant-content read ships
      // dark until Phase 4's ux-developer commit lands the page behind it.
      description:
        "Congregation directory page in (org). OFF = /o/<slug>/directory renders 'isn't available yet' regardless of the viewer's directory.view grant.",
      enabled: false,
    },
    {
      key: "org_portal.roles",
      // ON: /o/<slug>/admin/roles is reachable at all. Checked bare, no
      // DECISION-026 fail-open wrapper — it's a toggle, not an auth path
      // (Phase 3, docs/work-log/2026-08-19-tenant-administration.md).
      // Never substitutes for role_grants.manage: a stated clerk with the
      // flag on and no grant still sees the in-shell "you don't have
      // permission" state, not the roles page itself (DECISION-003: a flag
      // never gates a permission). Seeded OFF, same "ships dark until the
      // page lands" reasoning as org_portal.directory.
      description:
        "Tenant role-administration page in (org). OFF = /o/<slug>/admin/roles renders 'isn't available yet' regardless of the viewer's role_grants.manage grant.",
      enabled: false,
    },
    {
      key: "org_portal.tickets",
      // ON: /o/<slug>/tickets* AND /o/<slug>/feedback are reachable at all —
      // ONE flag gates both, deliberately (support-tickets pipeline, Phase
      // 3: "there is no product reason to ship the on-ramp without the
      // destination or vice versa, and a second flag would only invite the
      // two drifting out of sync"). Checked bare, no DECISION-026 fail-open
      // wrapper — a toggle, not an auth path. Never substitutes for
      // tickets.file: a role-holder with the flag on and no grant still
      // sees the in-shell "you don't have permission" state, not the
      // tickets page itself (DECISION-003). Seeded OFF, same "ships dark
      // until the page lands" reasoning as org_portal.directory/roles.
      description:
        "Support-ticket filing/triage and the congregation-feedback on-ramp in (org). OFF = /o/<slug>/tickets* and /o/<slug>/feedback render 'isn't turned on yet' regardless of the viewer's tickets.file grant.",
      enabled: false,
    },
    {
      key: "sites.public_render",
      // ON: the public /site/<slug> render path AND the ingest endpoint are
      // both live. Checked bare, no DECISION-026 fail-open wrapper — this is
      // not an auth path, and fail-closed-to-404 during a DB blip or an
      // operator-initiated rollback is the correct direction here (public-
      // sites pipeline, Phase 2/3). Gates BOTH the read path
      // ((public)/site/[slug]/{page,layout}.tsx and the asset route) and
      // ingest — a disabled feature rejects ingest too, not just hides the
      // read path, so an org's content can't go "live" behind a flag that
      // then flips on with stale-vs-fresh ambiguity. Does NOT gate
      // /admin/organizations' provisioning UI or /admin/sites — an operator
      // can provision and monitor sites while the public path stays off.
      // Seeded OFF, same "ships dark until the page lands" reasoning as
      // org_portal.directory/roles/tickets.
      description:
        "Public per-org website render + ingest. OFF = /site/<slug> 404s and ingest is rejected, regardless of organization_sites.status.",
      enabled: false,
    },
  ];
  for (const f of defaults) {
    await db.insert(schema.featureFlags).values(f).onConflictDoNothing();
  }
  console.log(`seeded ${defaults.length} feature flags`);
}

/**
 * Platform-wide `group_types` templates (`organization_id IS NULL`) — the two
 * this codebase's own F16 group-seeding needs: `court` (Session, Board of
 * Deacons) and `roster` (Active Membership). `committee` is deliberately NOT
 * seeded here (docs/work-log/2026-08-24-admin-org-create.md Phase 2/3): no
 * admin surface creates a `committee`-type group yet, so nothing in presby
 * needs that row in a production-reachable seed path today.
 *
 * Without this, `createOrganization()` (src/lib/org-provisioning.ts) cannot
 * function against a real database at all — it fails closed with
 * `{ kind: "provisioning_incomplete" }` rather than create an org with no
 * derived groups. This is a ONE-TIME PLATFORM BOOTSTRAP: run `npm run
 * db:seed` once against a target database before the first
 * createOrganization() call there, not on every deploy.
 *
 * NOT `.onConflictDoNothing()` (the design doc's literal suggestion, matching
 * the `roles`/`features` pattern elsewhere in this file) — `group_types` has
 * NO unique constraint on `(organization_id, key)`, only a non-unique index
 * (`group_types_org_idx`). `id` is the sole unique column and is always a
 * fresh `defaultRandom()` UUID, so `ON CONFLICT DO NOTHING` would never
 * actually fire and re-running this script would insert a second `court`/
 * `roster` row every time. Explicit find-or-create instead, confirmed
 * idempotent by running twice against the dev database (see work-log Phase 4
 * Implementer Notes).
 */
async function seedGroupTypes() {
  const defs = [
    { key: "court", name: "Court" },
    { key: "roster", name: "Roster" },
  ];
  for (const g of defs) {
    // Both the read and the write use platformDb, not db — group_types is a
    // FORCE-RLS tenant table (see this function's own header comment). db
    // (presby_app, no org context) would see ZERO rows for a null-org-id
    // template even if one already exists, fail-closed by construction, and
    // would then fail the INSERT with a real RLS violation.
    const [existing] = await platformDb
      .select({ id: groupTypes.id })
      .from(groupTypes)
      .where(and(isNull(groupTypes.organizationId), eq(groupTypes.key, g.key)))
      .limit(1);
    if (!existing) {
      await platformDb
        .insert(groupTypes)
        .values({ organizationId: null, key: g.key, name: g.name });
    }
  }
  console.log(`seeded ${defs.length} platform-wide group_types`);
}

async function bindAdminFeatures() {
  const admin = await db.query.roles.findFirst({
    where: eq(schema.roles.name, ADMIN_ROLE),
  });
  if (!admin) return;
  for (const key of Object.values(FEATURES)) {
    await db
      .insert(schema.roleFeatures)
      .values({ roleId: admin.id, featureKey: key })
      .onConflictDoNothing();
  }
  console.log("bound all features to admin");
}

async function bindSupportOperatorFeatures() {
  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.name, SUPPORT_OPERATOR_ROLE),
  });
  if (!role) return;
  for (const key of [FEATURES.ADMIN_TICKETS, FEATURES.ADMIN_FEEDBACK]) {
    await db
      .insert(schema.roleFeatures)
      .values({ roleId: role.id, featureKey: key })
      .onConflictDoNothing();
  }
  console.log("bound tickets + feedback features to support_operator");
}

async function seedLocalAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";

  if (!email || !password) {
    console.warn(
      "[seed] SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping local admin seed. " +
        "Set both in .env.local to provision a credentials-login admin for testing.",
    );
    return;
  }

  const hash = await bcrypt.hash(password, 10);

  // Upsert the user. Password updates on each run so you can rotate it via
  // .env.local without manual DB surgery.
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  let userId: string;
  if (existing) {
    // Rotate the password and reactivate, but do NOT silently flip
    // `twoFactorRequired` back to false — a fork that enabled 2FA on this
    // user wants to keep it on across reseeds.
    await db
      .update(schema.users)
      .set({
        password: hash,
        isActive: true,
        name: existing.name ?? "Local Admin",
        failedLoginAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(schema.users.id, existing.id));
    userId = existing.id;
    console.log(`[seed] updated local admin: ${email}`);
  } else {
    const [created] = await db
      .insert(schema.users)
      .values({
        email,
        name: "Local Admin",
        password: hash,
        emailVerified: new Date(),
        // Disabled on initial seed so /admin loads in one click for testing.
        // Flip to `true` (or omit) once you've enrolled in 2FA.
        twoFactorRequired: false,
      })
      .returning({ id: schema.users.id });
    userId = created.id;
    console.log(`[seed] created local admin: ${email}`);
  }

  const adminRole = await db.query.roles.findFirst({
    where: eq(schema.roles.name, ADMIN_ROLE),
  });
  if (adminRole) {
    await db
      .insert(schema.userRoles)
      .values({ userId, roleId: adminRole.id })
      .onConflictDoNothing();
    console.log("[seed] bound local admin to admin role");
  }
}

async function seedMemberUser() {
  const email = (process.env.SEED_MEMBER_EMAIL ?? "").toLowerCase().trim();
  const password = process.env.SEED_MEMBER_PASSWORD ?? "";

  if (!email || !password) {
    console.warn(
      "[seed] SEED_MEMBER_EMAIL / SEED_MEMBER_PASSWORD not set — skipping member seed. " +
        "Set both in .env.local to provision a credentials-login member for e2e testing.",
    );
    return;
  }

  const hash = await bcrypt.hash(password, 10);

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  let userId: string;
  if (existing) {
    await db
      .update(schema.users)
      .set({
        password: hash,
        isActive: true,
        name: existing.name ?? "Local Member",
        failedLoginAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(schema.users.id, existing.id));
    userId = existing.id;
    console.log(`[seed] updated local member: ${email}`);
  } else {
    const [created] = await db
      .insert(schema.users)
      .values({
        email,
        name: "Local Member",
        password: hash,
        emailVerified: new Date(),
        twoFactorRequired: false,
      })
      .returning({ id: schema.users.id });
    userId = created.id;
    console.log(`[seed] created local member: ${email}`);
  }

  const memberRole = await db.query.roles.findFirst({
    where: eq(schema.roles.name, MEMBER_ROLE),
  });
  if (memberRole) {
    await db
      .insert(schema.userRoles)
      .values({ userId, roleId: memberRole.id })
      .onConflictDoNothing();
    console.log("[seed] bound local member to member role");
  }
}

async function seedMfaAdminUser() {
  const email = (process.env.SEED_MFA_ADMIN_EMAIL ?? "").toLowerCase().trim();
  const password = process.env.SEED_MFA_ADMIN_PASSWORD ?? "";

  if (!email || !password) {
    console.warn(
      "[seed] SEED_MFA_ADMIN_EMAIL / SEED_MFA_ADMIN_PASSWORD not set — skipping MFA admin seed. " +
        "Set both in .env.local to provision a 2FA-gated admin for e2e routing tests.",
    );
    return;
  }

  const hash = await bcrypt.hash(password, 10);

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  let userId: string;
  if (existing) {
    await db
      .update(schema.users)
      .set({
        password: hash,
        isActive: true,
        name: existing.name ?? "Local MFA Admin",
        // Preserve twoFactorRequired=true on re-seed — do not flip it back.
        twoFactorRequired: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(schema.users.id, existing.id));
    userId = existing.id;
    console.log(`[seed] updated local MFA admin: ${email}`);
  } else {
    const [created] = await db
      .insert(schema.users)
      .values({
        email,
        name: "Local MFA Admin",
        password: hash,
        emailVerified: new Date(),
        // twoFactorRequired=true so proxy gates /admin routes behind TOTP.
        // No TOTP enrollment record is created — the e2e test only asserts the
        // redirect to /totp fires, not that the full challenge can be completed.
        twoFactorRequired: true,
      })
      .returning({ id: schema.users.id });
    userId = created.id;
    console.log(`[seed] created local MFA admin: ${email}`);
  }

  const adminRole = await db.query.roles.findFirst({
    where: eq(schema.roles.name, ADMIN_ROLE),
  });
  if (adminRole) {
    await db
      .insert(schema.userRoles)
      .values({ userId, roleId: adminRole.id })
      .onConflictDoNothing();
    console.log("[seed] bound local MFA admin to admin role");
  }
}

async function main() {
  await seedRoles();
  await seedFeatures();
  await seedFlags();
  await seedGroupTypes();
  await bindAdminFeatures();
  await bindSupportOperatorFeatures();
  await seedLocalAdmin();
  await seedMemberUser();
  await seedMfaAdminUser();
  console.log("done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
