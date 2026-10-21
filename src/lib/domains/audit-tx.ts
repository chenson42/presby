/**
 * Re-export shim. `insertAuditRow` (the in-transaction audit insert) was lifted
 * to `src/lib/audit-tx.ts` so modules outside `src/lib/domains/` can use it
 * (docs/work-log/2026-10-21-invitations.md, Phase 2 S3). Both import paths work;
 * new code imports `@/lib/audit-tx`.
 */
export { AUDIT_ACTIONS, insertAuditRow, type AuditActor } from "@/lib/audit-tx";
