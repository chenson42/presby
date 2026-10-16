"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { useHydrated } from "@/components/shared/use-hydrated";
import type { DonorLink } from "@/lib/giving/donors";
import type { LinkProposal } from "@/lib/giving/link-proposals";
import { confirmLinkAction, dismissLinkAction, removeLinkAction } from "./actions";

/**
 * A donor's link to a member - docs/work-log/2026-10-15-online-giving.md,
 * Flow 9 and the account-takeover row of the adversarial table.
 *
 * What a link DOES, said in the dialog because it is the point: it lets that
 * member see this donor's giving history in the portal (and nobody else).
 * Confirming therefore NAMES the person in an AlertDialog and asks again; a
 * proposal is only ever a suggestion ("same email on file"). "Not this person"
 * is recorded so the pair is never suggested again; removing a link is also
 * recorded. Read-only (`canLink` false) for a holder of `giving.view` alone: the
 * state is shown, the controls are not. Plain `onClick` controls render
 * disabled until hydrated (F129).
 */
export function LinkPanel({
  slug,
  donorId,
  link,
  proposals,
  canLink,
}: {
  slug: string;
  donorId: string;
  link: DonorLink | null;
  proposals: LinkProposal[];
  canLink: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string; kind?: string; redirectTo?: string }>, success: string) {
    setPending(key);
    const result = await fn();
    setPending(null);
    if (result.ok) {
      toast.success(success);
      router.refresh();
    } else if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
    } else {
      toast.error(result.error ?? "That didn't work. Try again.");
    }
  }

  if (link) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Linked to a member</Badge>
          <p className="text-base font-medium" data-testid="linked-member">
            {link.personName}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {link.personName} can see this donor&apos;s giving history in the member portal.
        </p>
        {canLink && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated || pending !== null}>
                Remove link
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove the link to {link.personName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {link.personName} will no longer see this donor&apos;s giving history in the portal.
                  No gift is changed, and this person won&apos;t be suggested for this donor again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep the link</AlertDialogCancel>
                <AlertDialogAction onClick={() => run("remove", () => removeLinkAction(slug, { donorId }), "Link removed.")}>
                  Remove link
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    );
  }

  if (proposals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Not linked to a member. When a donor&apos;s email matches a member&apos;s, a suggestion appears here.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {proposals.map((proposal) => (
        <li key={proposal.membershipId} className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-base">
            Looks like <span className="font-medium">{proposal.personName}</span> &mdash; the same email is on file.
          </p>
          {canLink ? (
            <div className="flex flex-wrap gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" className="min-h-11" disabled={!hydrated || pending !== null}>
                    Link to {proposal.personName}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Link this donor to {proposal.personName}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {proposal.personName} will be able to see this donor&apos;s giving history in the
                      member portal. Only link them if you are sure they are the same person &mdash; a
                      matching email is a hint, not proof.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Not yet</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        run(
                          `confirm-${proposal.membershipId}`,
                          () => confirmLinkAction(slug, { donorId, membershipId: proposal.membershipId }),
                          "Donor linked.",
                        )
                      }
                    >
                      Yes, link them
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={!hydrated || pending !== null}
                onClick={() =>
                  run(
                    `dismiss-${proposal.membershipId}`,
                    () => dismissLinkAction(slug, { donorId, membershipId: proposal.membershipId }),
                    "Got it. We won't suggest them again.",
                  )
                }
              >
                Not this person
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Someone who records gifts can confirm or dismiss this.</p>
          )}
        </li>
      ))}
    </ul>
  );
}
