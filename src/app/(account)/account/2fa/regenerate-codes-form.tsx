"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { regenerateRecoveryCodes } from "./actions";
import { RecoveryCodesPanel } from "./recovery-codes-panel";

export function RegenerateCodesForm() {
  const [pending, setPending] = useState(false);
  const [freshCodes, setFreshCodes] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const result = await regenerateRecoveryCodes();
    setPending(false);
    if (result.ok && result.data) {
      setFreshCodes(result.data.recoveryCodes);
    } else if (!result.ok) {
      toast.error(result.error);
    }
  }

  if (freshCodes.length > 0) {
    return (
      <div className="mt-3">
        <RecoveryCodesPanel
          heading="New recovery codes — save these now"
          headingLevel={3}
          intro="Your old codes are no longer valid. Each new code can be used once."
          codes={freshCodes}
          footnote="If you reload or leave this page, these codes will not be shown again."
        />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Regenerating…" : "Regenerate recovery codes"}
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        Replaces every existing code. The new set is shown once — save them
        before leaving the page.
      </p>
    </form>
  );
}
