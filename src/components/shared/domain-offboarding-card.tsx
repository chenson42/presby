import { ShieldAlert } from "lucide-react";
import type { ChecklistGroup } from "@/lib/domains/checklist";
import { DomainRecordRow } from "./domain-record-row";
import { FormattedDate } from "./formatted-date";

/**
 * The exit checklist for a domain that is lapsed, parked (removed) or being
 * released (Flow 6, G10, G26). Tells the church which records to delete from
 * its DNS, in what order, and the one thing that bites people: browsers have
 * been told to insist on HTTPS for this name (HSTS), so the place the domain
 * points NEXT must already serve it with a valid certificate before these
 * records go.
 *
 * It never tells anyone to delete an MX or SPF record. The ownership (TXT)
 * record is listed as "keep until released" because it is what stops a stranger
 * claiming the name in the meantime.
 */
export function DomainOffboardingCard({ group, idPrefix }: { group: ChecklistGroup; idPrefix: string }) {
  if (!group.offboarding) return null;
  const toDelete = group.records.filter((r) => r.kind === "routing");
  const keep = group.records.filter((r) => r.kind === "proof" || r.kind === "provider");
  const parked = group.phase === "parked";
  return (
    <section
      aria-labelledby={`${idPrefix}-off`}
      data-testid="offboarding-card"
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <h3 id={`${idPrefix}-off`} className="text-lg font-semibold">
        Clean up your DNS
      </h3>

      <p className="flex gap-3 rounded-md border border-foreground/50 p-3 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong>Before you delete anything,</strong> make sure the place this domain points next already serves it
          over valid HTTPS. Browsers have been told to insist on HTTPS for this domain, so visitors who have been to
          your site recently will see a security warning until the new place has a working certificate.
        </span>
      </p>

      {toDelete.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-base font-medium">Delete these records from your DNS</h4>
          <ul className="space-y-2">
            {toDelete.map((r, i) => (
              <DomainRecordRow key={`${r.type}-${r.name}-${r.value}`} record={r} id={`${idPrefix}-del-${i}`} compact />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          There are no records pointing at us that we know of. If you added any, delete the ones that point at
          PresbyPortal&apos;s hosting.
        </p>
      )}

      {keep.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-base font-medium">Keep this one until the domain is released</h4>
          <p className="text-sm text-muted-foreground">
            Keep this record in place; it protects your domain from being claimed by someone else. Once the domain is
            released you can delete it too.
          </p>
          <ul className="space-y-2">
            {keep.map((r, i) => (
              <DomainRecordRow key={`${r.type}-${r.name}`} record={r} id={`${idPrefix}-keep-${i}`} compact />
            ))}
          </ul>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Your existing email records (MX, SPF) are not part of this and should stay as they are.
        {parked && (
          <>
            {" "}
            We check once a week whether your records still point at us, and email you while they do.
            {group.graceEndsAt && (
              <>
                {" "}
                We hold the domain until <FormattedDate value={group.graceEndsAt} mode="date" />, then release it.
              </>
            )}
          </>
        )}
      </p>
    </section>
  );
}
