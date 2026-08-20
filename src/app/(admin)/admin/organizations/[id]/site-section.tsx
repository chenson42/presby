"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { SiteAdminDetail } from "@/lib/sites";
import { provisionSiteAction, setSiteStatusAction, type PolicyResult } from "./actions";

/**
 * Third section on `/admin/organizations/<id>` — provision a public site
 * (a `site-<slug>` repo reference) and manage its live/suspended status.
 * Same "one section per concern on one page" shape brand's own "Current
 * brand" / "Set brand" sections already established. See
 * docs/work-log/2026-08-20-public-sites.md Phase 3, "Component / Page Plan".
 *
 * A CLIENT COMPONENT WRAPPING BOTH FORMS, not two separate files — the
 * provision form and the status control are mutually exclusive views of the
 * same `SiteAdminDetail | null` (no site yet vs. a site that exists), so
 * splitting them would just move the same conditional one level up with no
 * gain.
 */

const STATUS_BADGE: Record<string, string> = {
  provisioning:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-200",
  live: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200",
  suspended: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

async function submitProvision(
  _prev: PolicyResult | null,
  formData: FormData,
): Promise<PolicyResult> {
  return provisionSiteAction(formData);
}

function ProvisionForm({ organizationId }: { organizationId: string }) {
  const [result, formAction, isPending] = useActionState(
    submitProvision,
    null as PolicyResult | null,
  );

  return (
    <form action={formAction} className="max-w-sm space-y-4">
      <input type="hidden" name="organizationId" value={organizationId} />

      {result && !result.ok && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {result.error}
        </div>
      )}

      <div>
        <Label htmlFor="repo">Content repository</Label>
        <Input
          id="repo"
          name="repo"
          type="text"
          placeholder="owner/repo"
          required
          aria-describedby="repoHelp"
        />
        <p id="repoHelp" className="mt-1.5 text-xs text-muted-foreground">
          The `site-&lt;slug&gt;` GitHub repository this organization&apos;s
          public site is provisioned from, as &quot;owner/repo&quot;.
        </p>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Provisioning…" : "Provision site"}
      </Button>
    </form>
  );
}

async function submitStatus(
  _prev: PolicyResult | null,
  formData: FormData,
): Promise<PolicyResult> {
  return setSiteStatusAction(formData);
}

function SuspendControl({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    const fd = new FormData();
    fd.set("organizationId", organizationId);
    fd.set("status", "suspended");
    const result = await setSiteStatusAction(fd);
    setPending(false);
    if (result.ok) {
      toast.success(`${organizationName}'s site has been suspended.`);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          Suspend site
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Suspend {organizationName}&apos;s public site?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The public site immediately stops rendering — visitors see the
            same &quot;not found&quot; response as an organization with no
            site at all. Content stays staged: the next ingest still updates
            it, and reactivating serves the latest content right away.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Suspending…" : `Yes, suspend ${organizationName}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReactivateForm({ organizationId }: { organizationId: string }) {
  const [result, formAction, isPending] = useActionState(
    submitStatus,
    null as PolicyResult | null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="status" value="live" />
      {result && !result.ok && (
        <p className="mb-2 text-sm text-red-600 dark:text-red-400">
          {result.error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Reactivating…" : "Reactivate site"}
      </Button>
    </form>
  );
}

export function SiteSection({
  organizationId,
  organizationName,
  site,
}: {
  organizationId: string;
  organizationName: string;
  site: SiteAdminDetail | null;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Site
      </h2>

      {!site ? (
        <div className="mt-3 space-y-4">
          <p className="text-sm text-muted-foreground">
            This organization has no public site provisioned yet.
          </p>
          <ProvisionForm organizationId={organizationId} />
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge
              variant="outline"
              className={
                STATUS_BADGE[site.status] ?? "bg-muted text-muted-foreground"
              }
            >
              {site.status}
            </Badge>
            <span className="text-sm text-muted-foreground">{site.repo}</span>
          </div>

          <dl className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            <div>
              <dt className="font-medium text-foreground">Last ingested</dt>
              <dd>
                {site.lastIngestedAt ? (
                  <FormattedDate value={site.lastIngestedAt} mode="datetime" />
                ) : (
                  "Never"
                )}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Last commit</dt>
              <dd className="font-mono text-xs">
                {site.lastIngestedCommitSha
                  ? site.lastIngestedCommitSha.slice(0, 10)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Provisioned</dt>
              <dd>
                <FormattedDate value={site.createdAt} mode="date" />
              </dd>
            </div>
          </dl>

          <div>
            {site.status === "suspended" ? (
              <ReactivateForm organizationId={organizationId} />
            ) : (
              <SuspendControl
                organizationId={organizationId}
                organizationName={organizationName}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
