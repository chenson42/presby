"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { StatisticsGrantRow } from "@/lib/statistics-grants";
import { revokeStatisticsGrantAction } from "./actions";

const STATUS_LABELS: Record<StatisticsGrantRow["status"], string> = {
  issued: "Issued",
  expired: "Expired",
  revoked: "Revoked",
  submitted: "Filed",
};

function statusVariant(
  status: StatisticsGrantRow["status"],
): "default" | "secondary" | "outline" {
  if (status === "submitted") return "default";
  if (status === "issued") return "secondary";
  return "outline";
}

/**
 * Every submission grant this presbytery has ever issued — increment 6
 * (D16/DECISION-147). "Already filed" (`submitted`) and "revoked, never
 * filed" (`revoked`) are DISTINCT statuses, never conflated (Phase 1 Flow
 * 2's own failure case) — `listStatisticsGrants()` already resolves this
 * server-side (`src/lib/statistics-grants.ts`'s `statusOf()`), this
 * component only renders it.
 *
 * Revoke uses a shadcn `AlertDialog`, never `confirm()` (Workflow Rule 2),
 * modeled on `../roles/revoke-dialog.tsx`.
 */
export function GrantsTable({
  slug,
  grants,
}: {
  slug: string;
  grants: StatisticsGrantRow[];
}) {
  if (grants.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No submission grants issued yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Issue one below to let an unmanaged or invited congregation file its
          statistical report without an account.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Congregation</TableHead>
          <TableHead>Year</TableHead>
          <TableHead>Recipient</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Expires</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {grants.map((grant) => (
          <TableRow key={grant.id}>
            <TableCell className="max-w-[8rem] whitespace-normal font-medium sm:max-w-none sm:whitespace-nowrap">
              {grant.aboutOrgName}
            </TableCell>
            <TableCell>{grant.reportYear}</TableCell>
            <TableCell className="max-w-[10rem] truncate">
              {grant.issuedToName}
              <span className="block text-sm text-muted-foreground">
                {grant.issuedToEmail}
              </span>
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(grant.status)}>
                {STATUS_LABELS[grant.status]}
              </Badge>
              {grant.status === "submitted" && grant.submittedAt && (
                <span className="mt-1 block text-sm text-muted-foreground">
                  <FormattedDate value={grant.submittedAt} mode="date" />
                </span>
              )}
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              <FormattedDate value={grant.expiresAt} mode="date" />
            </TableCell>
            <TableCell className="text-right">
              {grant.status === "issued" && (
                <RevokeGrantButton
                  slug={slug}
                  grantId={grant.id}
                  aboutOrgName={grant.aboutOrgName}
                  reportYear={grant.reportYear}
                />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RevokeGrantButton({
  slug,
  grantId,
  aboutOrgName,
  reportYear,
}: {
  slug: string;
  grantId: string;
  aboutOrgName: string;
  reportYear: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    const result = await revokeStatisticsGrantAction(slug, grantId);
    setPending(false);
    if (result.ok) {
      toast.success(`Grant for ${aboutOrgName}'s ${reportYear} report revoked.`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9">
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Revoke the {reportYear} grant for {aboutOrgName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The filing link already sent for {aboutOrgName}&apos;s {reportYear}{" "}
            report will stop working immediately. You can issue a new grant
            afterward.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Revoking…" : "Yes, revoke"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
