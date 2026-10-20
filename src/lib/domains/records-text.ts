import type { ChecklistGroup, ChecklistRecord, RecordHint } from "./checklist";

/**
 * records-text.ts - the plain-text and `mailto:` renderings of a claim's DNS
 * records (G11: "copy all records as text" and a `mailto:` link for the DNS
 * person, who is often not the administrator). PURE.
 *
 * A `mailto:` link is deliberate: the church's own mail client sends it, so the
 * platform never mails an arbitrary address (an open relay). The text names the
 * DNS name, type and value of each record and never an instruction to delete
 * MX or SPF.
 */

const KEEP: Partial<Record<RecordHint, string>> = {
  keep_record: "Keep this record in place; it protects the domain from being claimed by someone else.",
};

function line(r: ChecklistRecord): string {
  const keep = r.keep || r.hint === "keep_record" ? `\n  ${KEEP.keep_record}` : "";
  return `Type: ${r.type}\n  Name: ${r.name}\n  Value: ${r.value}${keep}`;
}

/** Everything the DNS person needs, as text. */
export function recordsAsText(group: Pick<ChecklistGroup, "displayName" | "records">): string {
  const head = `DNS records to add for ${group.displayName}`;
  const body = group.records.map((r, i) => `${i + 1}.\n  ${line(r)}`).join("\n\n");
  const foot =
    "Add each record at the company that hosts the DNS for this domain. " +
    "Do not change or delete any existing MX or SPF records. " +
    "DNS changes can take up to an hour to be seen.";
  return `${head}\n\n${body}\n\n${foot}`;
}

/** A `mailto:` URL with the records as the body, for the church to send to its DNS person. */
export function recordsMailto(group: Pick<ChecklistGroup, "displayName" | "records">): string {
  const subject = `DNS records to add for ${group.displayName}`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(recordsAsText(group))}`;
}
