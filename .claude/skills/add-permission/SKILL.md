---
name: add-permission
description: Add a new feature permission to FEATURE_CATALOG and optionally bind it to a role on next seed
argument-hint: "[permission.key]"
---

# Add Feature Permission

When the user invokes `/add-permission`, walk through adding a new feature permission to the starter's permission system. The permission key may be provided as `$ARGUMENTS` (e.g., `audit.read`).

The starter uses `FEATURE_CATALOG` in `src/lib/permissions.ts` as the source of truth. The seed script (`scripts/seed.ts`) reads this catalog and inserts each feature into the `features` table. Role bindings happen in the seed too.

## Step 1: Gather Information

Ask the user (if not already provided):

1. **Permission key** — dot-notation (e.g., `audit.read`, `users.invite`, `api_keys.manage`).
2. **Constant name** — UPPER_SNAKE_CASE for the `FEATURES` object (e.g., `AUDIT_READ`).
3. **Human-readable name** — for the admin UI (e.g., "Read audit log").
4. **Description** — one sentence; shown next to the name in the admin roles editor.
5. **Category** — usually `admin`; add a new category if the feature belongs to a non-admin surface.
6. **Default roles** — which roles get this permission on a fresh seed? Usually `admin`. Sometimes also `member`. Rarely none (the user assigns it manually).

## Step 2: Update `src/lib/permissions.ts`

Add the new key to the `FEATURES` constant:

```typescript
export const FEATURES = {
  // ... existing entries ...
  AUDIT_READ: "audit.read",
} as const;
```

Add the matching `FEATURE_CATALOG` entry:

```typescript
{
  key: FEATURES.AUDIT_READ,
  name: "Read audit log",
  description: "View the append-only audit log of security-sensitive actions.",
  category: "admin",
},
```

Keep the catalog entries in the same order as the `FEATURES` constant — it makes review diffs easier to read.

## Step 3: Wire the Default Role Binding (Optional)

If the new permission should be granted to a role on a fresh seed, edit `scripts/seed.ts` and add the feature key to that role's binding list. The seed is idempotent — re-running it is safe.

For an existing database, the seed will only *add* the binding; it will not revoke it from any role that already has the permission via custom assignment. That's the right behavior.

## Step 4: Apply the Change Locally

```bash
npm run db:seed
```

This inserts the new row into `features` and (if you updated `scripts/seed.ts`) binds it to the configured roles.

If you want to verify, you can check `features` directly with the Neon SQL Editor or via `npm run db:push -- --dry-run` to inspect drift.

## Step 5: Use the New Permission

The two consumer patterns are:

**API route handler / server action:**
```typescript
import { auth } from "@/auth";
import { FEATURES, hasFeature } from "@/lib/permissions";

const session = await auth();
if (!hasFeature(session?.user?.features, FEATURES.AUDIT_READ)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

**UI conditional render:**
```typescript
const canRead = hasFeature(session?.user?.features, FEATURES.AUDIT_READ);
{canRead && <AuditLogPanel />}
```

## Step 6: Document and Release-Note

- Add a row to the feature inventory in `CLAUDE.md` if one is maintained there.
- Run `/release-notes` to record the new permission in the current release notes file.

## Summary

Present what changed:

- New `FEATURES.<KEY>` constant in `src/lib/permissions.ts`
- New `FEATURE_CATALOG` entry (name, description, category)
- Seed binding updated (which roles get it on fresh install): yes / no
- Local seed run: PASS / FAIL
- Files modified
