import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { ChecklistGroup, ChecklistHost, GroupPhase } from "@/lib/domains/checklist";
import { recordsAsText, recordsMailto } from "@/lib/domains/records-text";
import type { DiagnosisCause } from "@/lib/domains/hints";
import { DomainBanners } from "./domain-banners";
import { DomainCopyAllButton } from "./domain-copy-all-button";
import { DomainDiagnosisPanel } from "./domain-diagnosis-panel";
import { DomainOffboardingCard } from "./domain-offboarding-card";
import { DomainRecordRow } from "./domain-record-row";
import { DomainPhaseChip } from "./domain-status-chip";
import { DomainStepList } from "./domain-step-list";
import { FormattedDate } from "./formatted-date";

/**
 * One claim group (a domain and, when it pairs, its `www.` twin) as the church
 * sees it: header with phase chip and "View your site", the four steps, banners,
 * the hosts and their roles, the DNS records with per-record status and copy
 * controls, the troubleshooting panel, and the exit checklist when it applies.
 *
 * The SAME component renders the platform admin's view of an organization
 * (G31: "exactly what the church sees"); the surrounding page supplies the
 * actions through `actions` and `hostActions` slots, so the tenant page wires
 * its server actions and the platform page wires its own, and neither can show
 * the other's buttons.
 */

const PHASE_CHIP: Record<GroupPhase, { tone: "good" | "wait" | "bad"; label: string }> = {
  proving: { tone: "wait", label: "Waiting for your ownership record" },
  connecting: { tone: "wait", label: "Connecting" },
  securing: { tone: "wait", label: "Securing your site" },
  live: { tone: "good", label: "Live" },
  lapsed: { tone: "bad", label: "Needs attention" },
  parked: { tone: "wait", label: "Removed" },
  releasing: { tone: "wait", label: "Releasing" },
};

const STATE_WORDS: Record<ChecklistHost["state"], string> = {
  pending: "Waiting for ownership record",
  verified: "Ownership confirmed",
  attach_pending: "Connecting",
  attached: "Securing with HTTPS",
  live: "Live",
  lapsed: "Needs attention",
  parked: "Removed, held for now",
  release_pending: "Being released",
  released: "Released",
  expired: "Expired",
};

const INTRO: Partial<Record<GroupPhase, string>> = {
  proving:
    "Add this record where you manage your domain's DNS. It proves you own the domain and changes nothing on your live site.",
  connecting:
    "Add these records where you manage your domain's DNS. Your existing email records (MX, SPF) stay exactly as they are.",
  securing:
    "Add these records where you manage your domain's DNS. Your existing email records (MX, SPF) stay exactly as they are.",
  live: "These records are what keep your domain pointing at your site. Leave them in place.",
  lapsed: "Put this record back at your DNS provider to restore your domain.",
};

function detectedCauses(group: ChecklistGroup): DiagnosisCause["key"][] {
  const out = new Set<DiagnosisCause["key"]>();
  for (const r of group.records) {
    if (r.hint === "proxied") out.add("proxied");
    if (r.hint === "leftover_aaaa") out.add("leftover_aaaa");
    if (r.hint === "caa") out.add("caa");
  }
  return [...out];
}

export function DomainClaimCard({
  group,
  idPrefix,
  actions,
  hostActions,
  supportHref,
  showCopyAll = true,
}: {
  group: ChecklistGroup;
  idPrefix: string;
  actions?: ReactNode;
  hostActions?: (host: ChecklistHost) => ReactNode;
  supportHref?: string;
  showCopyAll?: boolean;
}) {
  const chip = group.hosts.some((h) => h.hold !== null)
    ? { tone: "bad" as const, label: "Paused" }
    : PHASE_CHIP[group.phase];
  const showRecords = group.phase !== "parked" && group.phase !== "releasing" && group.records.length > 0;
  const needsHelp =
    group.phase === "connecting" || group.phase === "securing" || group.phase === "lapsed" || group.phase === "proving";

  return (
    <article
      aria-labelledby={`${idPrefix}-title`}
      data-testid="claim-card"
      data-claim={group.claimName}
      data-phase={group.phase}
      className="space-y-5 rounded-lg border border-border bg-card p-4 shadow-xs sm:p-6"
    >
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id={`${idPrefix}-title`} className="min-w-0 break-words text-xl font-semibold">
            {group.displayName}
          </h2>
          <DomainPhaseChip tone={chip.tone}>{chip.label}</DomainPhaseChip>
        </div>
        {group.liveUrl && (
          <a
            href={group.liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 text-base font-medium underline underline-offset-4"
          >
            View your site
            <ExternalLink className="size-4" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </header>

      {group.purpose === "web" && group.step !== 0 && <DomainStepList steps={group.steps} />}

      <DomainBanners banners={group.banners} />

      <section aria-labelledby={`${idPrefix}-hosts`} className="space-y-2">
        <h3 id={`${idPrefix}-hosts`} className="text-lg font-semibold">
          {group.hosts.length === 1 ? "Address" : "Addresses"}
        </h3>
        <ul className="divide-y divide-border rounded-md border border-border">
          {group.hosts.map((h) => (
            <li
              key={h.id}
              data-host={h.hostname}
              className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="break-words text-base font-medium">{h.displayHostname}</p>
                <p className="text-sm text-muted-foreground">
                  {h.role === "canonical"
                    ? "Primary address"
                    : h.role === "alias"
                      ? "Sends visitors to your primary address"
                      : null}
                  {h.role ? " · " : ""}
                  {STATE_WORDS[h.state]}
                  {h.hold === "paused" && " · Paused by PresbyPortal support"}
                  {h.hold === "disputed" && " · Under review by PresbyPortal support"}
                </p>
              </div>
              {hostActions?.(h)}
            </li>
          ))}
        </ul>
      </section>

      {showRecords && (
        <section aria-labelledby={`${idPrefix}-records`} className="space-y-3">
          <h3 id={`${idPrefix}-records`} className="text-lg font-semibold">
            DNS records
          </h3>
          {INTRO[group.phase] && <p className="text-sm text-muted-foreground">{INTRO[group.phase]}</p>}
          {group.phase === "proving" && (
            <p className="text-sm text-muted-foreground">
              Once we find it, we&apos;ll show the records that point your domain here.
            </p>
          )}
          {group.targetSource === "generic" && group.records.some((r) => r.kind === "routing") && (
            <p data-testid="generic-targets-note" className="text-sm text-muted-foreground">
              These are our hosting provider&apos;s standard values. They work for every account; if our provider
              recommends something different for yours, we&apos;ll update them here.
            </p>
          )}
          <ul className="space-y-3">
            {group.records.map((r, i) => (
              <DomainRecordRow key={`${r.kind}-${r.type}-${r.name}-${r.value}`} record={r} id={`${idPrefix}-rec-${i}`} />
            ))}
          </ul>
          {showCopyAll && (
            <DomainCopyAllButton text={recordsAsText(group)} mailto={recordsMailto(group)} idPrefix={idPrefix} />
          )}
        </section>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {actions}
        {group.lastCheckedAt && (
          <p className="text-sm text-muted-foreground">
            Last checked <FormattedDate value={group.lastCheckedAt} />
          </p>
        )}
      </div>

      <DomainOffboardingCard group={group} idPrefix={idPrefix} />

      {needsHelp && <DomainDiagnosisPanel detected={detectedCauses(group)} supportHref={supportHref} />}
    </article>
  );
}
