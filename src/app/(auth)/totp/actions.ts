"use server";

import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { auth, unstable_update } from "@/auth";
import { db } from "@/lib/db";
import {
  userTotp,
  userTotpRecoveryCodes,
} from "@/lib/db/schema";
import {
  decryptSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyToken,
} from "@/lib/two-factor";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { sanitizeCallbackUrl } from "@/lib/auth/safe-callback";

function totpRedirectUrl(callbackUrl: string, error?: "invalid" | "rate_limited"): string {
  const params = new URLSearchParams({ callbackUrl });
  if (error) params.set("error", error);
  return `/totp?${params.toString()}`;
}

export async function verifyTotpAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const rawInput = String(formData.get("token") ?? "");
  const callbackUrl = sanitizeCallbackUrl(
    formData.get("callbackUrl") as string | null,
  );

  const enrollment = await db.query.userTotp.findFirst({
    where: eq(userTotp.userId, session.user.id),
  });
  if (!enrollment) redirect("/account/2fa");

  // Rate limit: 10/min by userId.
  // Rejection travels via redirect query param because this action always uses
  // redirect() rather than returning an ActionResult. retryAfterSeconds is NOT
  // forwarded — the UX copy is intentionally vague ("wait a moment") for the
  // short 1-minute window.
  const limited = await checkRateLimit(
    `totp:${session.user.id}`,
    { max: 10, windowSeconds: 60 },
    {
      userId: session.user.id,
      actor: session.user.email ?? session.user.id,
      reason: "totp_verify",
    },
  );
  if (!limited.allowed) redirect(totpRedirectUrl(callbackUrl, "rate_limited"));

  const trimmed = rawInput.trim();
  const isSixDigit = /^\d{6}$/.test(trimmed);

  // Explicit actor: session is already resolved above; passing it avoids a
  // second auth() call inside recordAudit() (Gap 5 resolution from Phase 1).
  const actor = { userId: session.user.id, email: session.user.email ?? null };

  if (isSixDigit) {
    const ok = verifyToken(trimmed, decryptSecret(enrollment.secretCiphertext));
    if (!ok) {
      await recordAudit({
        action: AUDIT_ACTIONS.TOTP_VERIFY_FAILED,
        actor,
        resourceType: "user",
        resourceId: session.user.id,
      });
      redirect(totpRedirectUrl(callbackUrl, "invalid"));
    }
    await db
      .update(userTotp)
      .set({ lastUsedAt: new Date() })
      .where(eq(userTotp.userId, session.user.id));
    await recordAudit({
      action: AUDIT_ACTIONS.TOTP_VERIFY_SUCCEEDED,
      actor,
      resourceType: "user",
      resourceId: session.user.id,
    });
    await unstable_update({ user: { twoFactorVerified: true } });
    redirect(callbackUrl);
  }

  // Try as recovery code.
  const normalized = normalizeRecoveryCode(trimmed);
  if (!normalized) {
    await recordAudit({
      action: AUDIT_ACTIONS.TOTP_VERIFY_FAILED,
      actor,
      resourceType: "user",
      resourceId: session.user.id,
      metadata: { reason: "malformed_input" },
    });
    redirect(totpRedirectUrl(callbackUrl, "invalid"));
  }
  const hash = hashRecoveryCode(normalized);
  const match = await db.query.userTotpRecoveryCodes.findFirst({
    where: and(
      eq(userTotpRecoveryCodes.userId, session.user.id),
      eq(userTotpRecoveryCodes.codeHash, hash),
      isNull(userTotpRecoveryCodes.usedAt),
    ),
  });
  if (!match) {
    await recordAudit({
      action: AUDIT_ACTIONS.TOTP_RECOVERY_FAILED,
      actor,
      resourceType: "user",
      resourceId: session.user.id,
    });
    redirect(totpRedirectUrl(callbackUrl, "invalid"));
  }
  await db
    .update(userTotpRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(eq(userTotpRecoveryCodes.id, match.id));
  await recordAudit({
    action: AUDIT_ACTIONS.TOTP_RECOVERY_SUCCEEDED,
    actor,
    resourceType: "user",
    resourceId: session.user.id,
    metadata: { codeId: match.id },
  });
  await unstable_update({ user: { twoFactorVerified: true } });
  redirect(callbackUrl);
}
