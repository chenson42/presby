import { vi, describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Module mocks — vi.mock() calls are hoisted by Vitest's module transformer.
// ---------------------------------------------------------------------------

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  unstable_update: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      userTotp: { findFirst: vi.fn() },
      userTotpPendingEnrollments: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoUpdate: vi.fn() })),
    })),
    delete: vi.fn(() => ({ where: vi.fn() })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  auditEvents: { _: "audit_events" },
  userTotp: { _: "user_totp" },
  userTotpPendingEnrollments: { _: "user_totp_pending" },
  userTotpRecoveryCodes: { _: "user_totp_recovery_codes" },
}));

vi.mock("@/lib/two-factor", () => ({
  FRESH_RECOVERY_CODES_COOKIE: "claudecode_fresh_recovery_codes",
  decryptSecret: vi.fn(),
  encryptSecret: vi.fn(),
  generateRecoveryCodes: vi.fn(() => ["CODE-0001"]),
  hashRecoveryCode: vi.fn((c: string) => `hash(${c})`),
  verifyToken: vi.fn(() => false),
  otpauthUrl: vi.fn(() => "otpauth://"),
  generateSecret: vi.fn(() => "FAKESECRET"),
}));

vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    TOTP_ENROLLED: "totp.enrolled",
    TOTP_RECOVERY_CODES_REGENERATED: "totp.recovery_codes.regenerated",
    TOTP_RESET: "totp.reset",
  },
}));

import { cookies } from "next/headers";
import { FRESH_RECOVERY_CODES_COOKIE } from "@/lib/two-factor";
import { clearFreshCodesCookieAction } from "./actions";

// ---------------------------------------------------------------------------
// clearFreshCodesCookieAction (admin) — regression for BUG-2
//
// Mirror of the account surface test. The admin cookie is path-scoped to
// "/admin/2fa" — a different scope from "/account/2fa". Both must use the
// exact matching path when deleting; otherwise the path-scoped cookie in the
// browser jar would not be cleared.
// ---------------------------------------------------------------------------

describe(
  "clearFreshCodesCookieAction (admin) — regression for BUG-2: cookie not cleared in server action",
  () => {
    let mockDelete: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockDelete = vi.fn();
      vi.mocked(cookies).mockResolvedValue({
        delete: mockDelete,
      } as unknown as Awaited<ReturnType<typeof cookies>>);
    });

    it("calls jar.delete with the correct cookie name", async () => {
      // Act
      await clearFreshCodesCookieAction();

      // Assert
      expect(mockDelete).toHaveBeenCalledTimes(1);
      const [arg] = mockDelete.mock.calls[0];
      expect(arg.name).toBe(FRESH_RECOVERY_CODES_COOKIE);
    });

    it("calls jar.delete with path '/admin/2fa' — regression for wrong path silently failing", async () => {
      // Act
      await clearFreshCodesCookieAction();

      // Assert — admin surface uses '/admin/2fa', not '/account/2fa'
      const [arg] = mockDelete.mock.calls[0];
      expect(arg.path).toBe("/admin/2fa");
    });

    it("calls jar.delete with the exact { name, path } object shape — combined regression", async () => {
      // Act
      await clearFreshCodesCookieAction();

      // Assert
      expect(mockDelete).toHaveBeenCalledWith({
        name: FRESH_RECOVERY_CODES_COOKIE,
        path: "/admin/2fa",
      });
    });
  },
);

// ---------------------------------------------------------------------------
// Static assertion — (admin)/admin/2fa/page.tsx must not contain jar.delete.
//
// FAIL-BEFORE evidence: before the fix, running
//   grep "jar.delete" src/app/(admin)/admin/2fa/page.tsx
// produced:
//   src/app/(admin)/admin/2fa/page.tsx:32:  jar.delete(FRESH_RECOVERY_CODES_COOKIE);
//
// This test now PASSES because the fix removed the illegal mutation.
// ---------------------------------------------------------------------------

describe(
  "(admin)/admin/2fa/page.tsx static analysis — regression for RSC cookie mutation",
  () => {
    const pageSource = readFileSync(
      resolve(__dirname, "page.tsx"),
      "utf-8",
    );

    it("page.tsx does not contain jar.delete — illegal RSC cookie mutation removed", () => {
      expect(pageSource).not.toContain("jar.delete");
    });

    it("page.tsx does not define consumeFreshCodesCookie — helper that contained the illegal delete", () => {
      expect(pageSource).not.toContain("consumeFreshCodesCookie");
    });
  },
);
