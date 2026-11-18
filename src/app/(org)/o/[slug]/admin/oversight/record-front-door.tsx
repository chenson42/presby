import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { OrgAccessError } from "@/lib/authz";
import { isUuid } from "@/lib/is-uuid";
import { readOversightAccess, type MemberCongregation } from "@/lib/oversight/reads";
import type { ReportIdentity } from "@/lib/presbytery-reports/gate";
import { OversightForbidden, OversightLoadError } from "./oversight-states";

/**
 * The steps every record page takes after `gateOversightPage` (which each
 * `page.tsx` calls itself, pinned by `boundaries.test.ts`): every id segment is a
 * UUID (a malformed one is a 404 before any read), then `readOversightAccess`,
 * the either-key front door. Neither key is `OversightForbidden` before the
 * congregation is resolved (no existence leak); a key and a congregation that is
 * not this presbytery's member is a 404, byte-identical to an absent one.
 */
export type OpenedRecord =
  | { ok: true; manage: boolean; finance: boolean; congregation: MemberCongregation }
  | { ok: false; view: ReactNode };

export async function openRecord(identity: ReportIdentity, slug: string, ids: string[]): Promise<OpenedRecord> {
  for (const id of ids) if (!isUuid(id)) notFound();

  const settled = await settle(readOversightAccess(identity, ids[0]));
  if (!settled.ok) return { ok: false, view: <OversightLoadError slug={slug} /> };
  const access = settled.value;
  if (access.kind === "forbidden") return { ok: false, view: <OversightForbidden name={identity.organizationName} /> };
  if (access.kind === "not_found" || access.data.congregation === null) notFound();
  return { ok: true, manage: access.data.manage, finance: access.data.finance, congregation: access.data.congregation };
}

/**
 * A read that failed for any reason but a lost membership: `{ ok: false }`, so
 * the page renders its own load error and the rest stays up. An `OrgAccessError`
 * (membership ended mid-request) propagates to `[slug]/error.tsx`.
 */
export async function settle<T>(read: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await read };
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return { ok: false };
  }
}
