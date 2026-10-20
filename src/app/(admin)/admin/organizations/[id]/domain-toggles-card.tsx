"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import { setOrgDomainFeatureAction } from "./domains-actions";

/**
 * The two operator-enabled toggles for one organization (operator ruling Q1:
 * platform admin only, for now). The church's own Features page never lists
 * them. A missing toggle row means OFF. Turning the website toggle OFF darkens
 * every one of the organization's custom hosts at once (serving requires it) but
 * leaves the rows and the checks in place.
 */

export const DOMAIN_TOGGLES = [
  {
    key: "org_portal.domains",
    label: "Website domain",
    description: "Lets the organization connect its own web address and serves it. Off darkens every custom host.",
  },
  {
    key: "org_portal.mail_domain",
    label: "Email from the church's domain",
    description: "For a later release. Turning it on has no effect yet.",
  },
] as const;

export function DomainTogglesCard({
  organizationId,
  organizationName,
  initial,
}: {
  organizationId: string;
  organizationName: string;
  initial: Record<string, boolean>;
}) {
  const hydrated = useHydrated();
  const [state, setState] = useState<Record<string, boolean>>(initial);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  async function flip(key: string) {
    const next = !state[key];
    setPendingKey(key);
    try {
      const result = await setOrgDomainFeatureAction(organizationId, key, next);
      if (result.ok) {
        setState((s) => ({ ...s, [key]: next }));
        toast.success(`${DOMAIN_TOGGLES.find((t) => t.key === key)?.label} is now ${next ? "on" : "off"} for ${organizationName}.`);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("That didn't go through. Try again.");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <section aria-labelledby="domain-features" className="rounded-lg border border-border bg-card p-4">
      <h3 id="domain-features" className="text-base font-semibold">
        Domain features
      </h3>
      <ul className="mt-3 divide-y divide-border">
        {DOMAIN_TOGGLES.map((t) => (
          <li key={t.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-base font-medium">
                {t.label}: <span data-testid={`toggle-state-${t.key}`}>{state[t.key] ? "On" : "Off"}</span>
              </p>
              <p className="text-sm text-muted-foreground">{t.description}</p>
            </div>
            <Button
              type="button"
              variant={state[t.key] ? "outline" : "default"}
              className="min-h-11"
              disabled={!hydrated || pendingKey !== null}
              onClick={() => flip(t.key)}
              aria-label={`${state[t.key] ? "Turn off" : "Turn on"} ${t.label}`}
            >
              {pendingKey === t.key ? "Saving…" : state[t.key] ? "Turn off" : "Turn on"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
