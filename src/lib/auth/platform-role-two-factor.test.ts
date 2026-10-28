/**
 * T5 (F343, DECISION-291): the platform-role two-factor helper, unit level. The
 * database behaviour (atomicity, concurrency, the audit row) is proven in
 * `platform-role-two-factor.db.test.ts`; this file pins what a mock can: the one
 * predicate, "no change means no audit", the null actor passed through, and
 * that the module can never re-enter the jwt callback through `auth()`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

const insertAuditRow = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/audit-tx", () => ({
  AUDIT_ACTIONS: { USER_2FA_REQUIRED_CHANGED: "user.2fa_required.changed" },
  insertAuditRow: (...args: unknown[]) => insertAuditRow(...args),
}));

const SRC = path.resolve(__dirname, "..", "..");
const FILE = path.join(__dirname, "platform-role-two-factor.ts");

/** A tx whose `select` resolves to `roleRows` and whose `update` returns `updated`. */
function fakeTx(roleRows: Array<{ name: string }>, updated: Array<{ id: string }>) {
  const calls = { select: 0, update: 0, set: [] as unknown[] };
  const tx = {
    select: () => {
      calls.select++;
      return { from: () => ({ where: () => ({ limit: async () => roleRows }) }) };
    },
    update: () => {
      calls.update++;
      return {
        set: (v: unknown) => {
          calls.set.push(v);
          return { where: () => ({ returning: async () => updated }) };
        },
      };
    },
  };
  return { tx: tx as never, calls };
}

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("requireTwoFactorForPlatformRole", () => {
  beforeEach(() => insertAuditRow.mockClear());

  it("module under test exists and exports the helper and the cause constant", async () => {
    const mod = await import("./platform-role-two-factor");
    expect(typeof mod.requireTwoFactorForPlatformRole).toBe("function");
    expect(mod.PLATFORM_ROLE_2FA_CAUSE).toBe("platform_role_granted");
  });

  it("a role that is not a platform role writes nothing and audits nothing", async () => {
    const { requireTwoFactorForPlatformRole } = await import("./platform-role-two-factor");
    const { tx, calls } = fakeTx([], [{ id: "u" }]);
    const out = await requireTwoFactorForPlatformRole(tx, { userId: "u", roleId: "r", actor: null });
    expect(out).toEqual({ changed: false, roleName: null });
    expect(calls.update).toBe(0);
    expect(insertAuditRow).not.toHaveBeenCalled();
  });

  it("a platform role whose update touches no row (already true) audits nothing", async () => {
    const { requireTwoFactorForPlatformRole } = await import("./platform-role-two-factor");
    const { tx, calls } = fakeTx([{ name: "admin" }], []);
    const out = await requireTwoFactorForPlatformRole(tx, { userId: "u", roleId: "r", actor: null });
    expect(out).toEqual({ changed: false, roleName: "admin" });
    expect(calls.update).toBe(1);
    expect(calls.set).toEqual([{ twoFactorRequired: true }]);
    expect(insertAuditRow).not.toHaveBeenCalled();
  });

  it("a changed row writes exactly one audit row, the actor passed through untouched (null stays null)", async () => {
    const { requireTwoFactorForPlatformRole } = await import("./platform-role-two-factor");
    const { tx } = fakeTx([{ name: "support_operator" }], [{ id: "u-1" }]);
    const out = await requireTwoFactorForPlatformRole(tx, { userId: "u-1", roleId: "r", actor: null });
    expect(out).toEqual({ changed: true, roleName: "support_operator" });
    expect(insertAuditRow).toHaveBeenCalledTimes(1);
    expect(insertAuditRow).toHaveBeenCalledWith(tx, {
      action: "user.2fa_required.changed",
      actor: null,
      resourceType: "user",
      resourceId: "u-1",
      metadata: { required: true, cause: "platform_role_granted", roleName: "support_operator" },
    });
  });

  it("a named actor is passed through as given", async () => {
    const { requireTwoFactorForPlatformRole } = await import("./platform-role-two-factor");
    const actor = { userId: "admin-1", email: "admin@example.invalid" };
    const { tx } = fakeTx([{ name: "admin" }], [{ id: "u-2" }]);
    await requireTwoFactorForPlatformRole(tx, { userId: "u-2", roleId: "r", actor });
    expect(insertAuditRow.mock.calls[0]![1]).toMatchObject({ actor });
  });
});

describe("platform-role-two-factor.ts source", () => {
  const code = stripComments(fs.readFileSync(FILE, "utf8"));

  it("never reaches auth(): no @/auth import, no auth( call, no recordAudit (R2d, E5)", () => {
    expect(code).not.toMatch(/@\/auth["']/);
    expect(code).not.toMatch(/\bauth\s*\(/);
    expect(code).not.toMatch(/\brecordAudit\b/);
    expect(code).not.toMatch(/@\/lib\/audit["']/);
  });

  it("states the platform-role predicate once: ADMIN_ROLE or a role_features row for admin.dashboard (R2a)", () => {
    expect(code).toMatch(/ADMIN_ROLE/);
    expect(code).toMatch(/FEATURES\.ADMIN_DASHBOARD/);
    expect(code).toMatch(/roleFeatures/);
  });

  it("is the only non-test source that reads role_features for admin.dashboard (nothing restates the predicate)", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : [p];
      });
    const holders = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => {
        const c = stripComments(fs.readFileSync(f, "utf8"));
        return /\broleFeatures\b|role_features/.test(c) && /ADMIN_DASHBOARD|admin\.dashboard/.test(c);
      })
      .map((f) => path.relative(SRC, f));
    expect(holders).toEqual([path.join("lib", "auth", "platform-role-two-factor.ts")]);
  });

  it("the conditional update is the changed-row gate: it filters on not-already-true and returns the row", () => {
    expect(code).toMatch(/twoFactorRequired,\s*false/);
    expect(code).toMatch(/\.returning\(/);
  });
});
