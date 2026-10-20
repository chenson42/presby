import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { OrgAccessError } from "@/lib/authz";
import { getGift, type GetGiftResult } from "@/lib/giving/gifts";
import { formatCents } from "@/lib/giving/money";
import { FormattedDate } from "@/components/shared/formatted-date";
import { GivingLoadError } from "../../giving-admin-states";
import { gateGivingPage } from "../../giving-page-gate";
import { GiftBadges, methodLabel } from "../gifts-list";
import { VoidGiftDialog } from "../void-dialog";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REVERSAL_LABELS: Record<string, string> = {
  refund: "Refund",
  dispute: "Dispute",
  ach_return: "Bank return",
  void: "Voided",
  reinstatement: "Reinstated",
};

/**
 * `/o/<slug>/admin/giving/gifts/[giftId]` - one gift, with its reversals and
 * where it came from (`giving.view`). docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Pages to create". Provenance is shown as recorded: who entered an
 * offline gift and when. A gift that does not exist in THIS organization is a
 * real 404 (the same answer as a malformed id), never a hint that it belongs to
 * another. The void control appears only when the viewer can actually use it.
 * No `loading.tsx`.
 */
export default async function GivingGiftPage({
  params,
}: {
  params: Promise<{ slug: string; giftId: string }>;
}) {
  const { slug, giftId } = await params;
  const path = `/o/${slug}/admin/giving/gifts/${giftId}`;
  const gate = await gateGivingPage({ slug, path, anyOf: ["view"], section: "Gifts" });
  if (!gate.ok) return gate.node;
  if (!UUID.test(giftId)) notFound();

  let result: GetGiftResult;
  try {
    result = await getGift(gate.org.personId, gate.org.organizationId, gate.userId, giftId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <GivingLoadError slug={slug} href={path} />;
  }
  if (result.kind === "not_found") notFound();
  if (result.kind === "forbidden") return <GivingLoadError slug={slug} href={path} />;
  const gift = result.gift;

  const rows: Array<[string, React.ReactNode]> = [
    ["Donor", <Link key="d" href={`/o/${slug}/admin/giving/donors/${gift.donorId}`} className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">{gift.donorName}</Link>],
    ["Date", <FormattedDate key="t" value={gift.occurredOn} mode="date" />],
    ["Fund", gift.fundName],
    ["How", `${methodLabel(gift.method, gift.source)}${gift.checkNumber ? ` #${gift.checkNumber}` : ""}`],
  ];
  if (gift.stockDescription) {
    rows.push(["Stock", `${gift.stockDescription}${gift.stockQuantity ? ` (${Number(gift.stockQuantity)} shares)` : ""}`]);
  }
  if (gift.source === "online") {
    if (gift.donorCoveredFeeCents > 0) rows.push(["Donor covered fees", formatCents(gift.donorCoveredFeeCents)]);
    if (gift.feeCents !== null) rows.push(["Processing fee", formatCents(gift.feeCents)]);
    if (gift.netCents !== null) rows.push(["Net to the church", formatCents(gift.netCents)]);
    if (gift.failureCode) rows.push(["Why it failed", gift.failureCode.replace(/_/g, " ")]);
  }
  if (gift.memo) rows.push(["Note", gift.memo]);
  rows.push([
    "Recorded",
    gift.source === "offline" ? (
      <span key="r">
        by {gift.recordedByName} on <FormattedDate value={gift.createdAt} />
      </span>
    ) : (
      <span key="r">
        automatically from Stripe on <FormattedDate value={gift.createdAt} />
      </span>
    ),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        href={`/o/${slug}/admin/giving/gifts`}
        className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
        Back to Gifts
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{formatCents(gift.amountCents)} gift</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <GiftBadges gift={gift} />
          </div>
        </div>
        {gift.canVoid && (
          <VoidGiftDialog slug={slug} giftId={gift.id} amountCents={gift.amountCents} donorName={gift.donorName} />
        )}
      </div>

      <dl className="divide-y divide-border rounded-lg border border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-1 gap-1 p-4 sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-base sm:col-span-2">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="gift-reversals" className="space-y-3">
        <h2 id="gift-reversals" className="text-xl font-semibold">
          Refunds and corrections
        </h2>
        {gift.reversals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has changed this gift since it was recorded.</p>
        ) : (
          <ul className="space-y-2">
            {gift.reversals.map((reversal) => (
              <li key={reversal.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-base font-medium">{REVERSAL_LABELS[reversal.kind] ?? reversal.kind}</p>
                  <p className="text-base font-semibold">{formatCents(reversal.amountCents)}</p>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  <FormattedDate value={reversal.occurredOn} mode="date" />
                  {reversal.recordedByName ? ` · by ${reversal.recordedByName}` : ""}
                </p>
                {reversal.reason && <p className="mt-1 text-sm">Reason: {reversal.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
