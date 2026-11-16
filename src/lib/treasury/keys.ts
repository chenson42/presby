import "server-only";

/**
 * `holdsPermissions` now lives in `src/lib/org-portal/permission-check.ts`
 * (DECISION-338); this alias keeps every giving, reimbursement and treasury
 * import working unchanged.
 */
export { holdsPermissions } from "@/lib/org-portal/permission-check";
