"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reinstateBuildingAction } from "@/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/buildings/actions";
import { TOAST } from "@/lib/oversight/copy";
import type { ValidationEnv } from "@/lib/oversight/validate";
import { ConfirmRemoveDialog } from "./confirm-remove-dialog";
import { RetireDialog } from "./retire-dialog";

/** The building page's controls: edit, retire or bring back into use, and remove. */
export function BuildingActions({
  slug,
  aboutOrgId,
  buildingId,
  buildingName,
  retired,
  env,
}: {
  slug: string;
  aboutOrgId: string;
  buildingId: string;
  buildingName: string;
  retired: boolean;
  env: ValidationEnv;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function bringBack() {
    setPending(true);
    const result = await reinstateBuildingAction(slug, aboutOrgId, buildingId);
    setPending(false);
    if (result.ok) {
      toast.success(TOAST.buildingReinstated);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Button asChild variant="outline" className="min-h-11">
        <Link href={`/o/${slug}/admin/oversight/${aboutOrgId}/buildings/${buildingId}/edit`}>Edit building</Link>
      </Button>
      {retired ? (
        <Button type="button" variant="outline" className="min-h-11" onClick={bringBack} disabled={pending}>
          Bring back into use
        </Button>
      ) : (
        <RetireDialog slug={slug} aboutOrgId={aboutOrgId} buildingId={buildingId} buildingName={buildingName} env={env} />
      )}
      <ConfirmRemoveDialog kind="building" slug={slug} aboutOrgId={aboutOrgId} buildingId={buildingId} />
    </div>
  );
}
