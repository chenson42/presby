"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import { issueStatisticsGrantAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export interface IssuableCongregation {
  organizationId: string;
  name: string;
}

/**
 * "Issue a submission grant" — increment 6 (D16/DECISION-147). The
 * congregation picker is filtered to `unmanaged`/`invited` congregations
 * BEFORE this component ever sees them (`page.tsx`'s
 * `renderSubmissionGrantsSection()`) — a UI convenience, never authority.
 * The real authority is the database trigger
 * (`presby_check_grant_about_org_unmanaged()`); a `managed` congregation
 * submitted anyway (a stale picker, a race) comes back as `invalid_input`
 * from `issueStatisticsGrantAction()` and is shown via `toast.error()`
 * exactly like any other rejection here — never trusted client-side.
 */
export function IssueGrantForm({
  slug,
  congregations,
}: {
  slug: string;
  congregations: IssuableCongregation[];
}) {
  const router = useRouter();
  const [aboutOrgId, setAboutOrgId] = useState(congregations[0]?.organizationId ?? "");
  const [reportYear, setReportYear] = useState(String(new Date().getFullYear() - 1));
  const [issuedToName, setIssuedToName] = useState("");
  const [issuedToEmail, setIssuedToEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (congregations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No unmanaged or invited member congregations are on record — every
        member congregation already has its own account and files through its
        own portal.
      </p>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const year = Number(reportYear);
    if (!Number.isInteger(year) || String(year).length !== 4) {
      toast.error("Enter a 4-digit year.");
      return;
    }
    if (!issuedToName.trim()) {
      toast.error("Enter the recipient's name.");
      return;
    }
    if (!issuedToEmail.trim() || !issuedToEmail.includes("@")) {
      toast.error("Enter a valid recipient email address.");
      return;
    }

    setSubmitting(true);
    const result = await issueStatisticsGrantAction(slug, {
      aboutOrgId,
      reportYear: year,
      issuedToName,
      issuedToEmail,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success("Grant issued. A filing link has been emailed to the recipient.");
      setIssuedToName("");
      setIssuedToEmail("");
      // revalidatePath() alone does not re-render an already-mounted page —
      // same fact this tree's other post-mutation forms already document.
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="grant-congregation">
            Congregation
            <RequiredMark />
          </Label>
          <div className="relative mt-1">
            <select
              id="grant-congregation"
              className={SELECT_CLASSES}
              aria-required="true"
              value={aboutOrgId}
              onChange={(e) => setAboutOrgId(e.target.value)}
              disabled={submitting}
            >
              {congregations.map((cong) => (
                <option key={cong.organizationId} value={cong.organizationId}>
                  {cong.name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>
        <div>
          <Label htmlFor="grant-year">
            Report year
            <RequiredMark />
          </Label>
          <Input
            id="grant-year"
            type="number"
            aria-required="true"
            className="mt-1"
            value={reportYear}
            onChange={(e) => setReportYear(e.target.value)}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="grant-recipient-name">
            Recipient name
            <RequiredMark />
          </Label>
          <Input
            id="grant-recipient-name"
            type="text"
            aria-required="true"
            className="mt-1"
            placeholder="e.g. the congregation's clerk of session"
            value={issuedToName}
            onChange={(e) => setIssuedToName(e.target.value)}
            disabled={submitting}
          />
        </div>
        <div>
          <Label htmlFor="grant-recipient-email">
            Recipient email
            <RequiredMark />
          </Label>
          <Input
            id="grant-recipient-email"
            type="email"
            aria-required="true"
            className="mt-1"
            value={issuedToEmail}
            onChange={(e) => setIssuedToEmail(e.target.value)}
            disabled={submitting}
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        A one-time filing link, valid for 45 days, will be emailed to this
        address. It can be used once.
      </p>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Issuing…" : "Issue grant"}
      </Button>
    </form>
  );
}
