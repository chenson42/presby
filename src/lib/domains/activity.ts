import { domainToUnicode } from "node:url";

/**
 * activity.ts - turns a `domain.*` audit row into one plain-English line for
 * the "Recent activity" list on `/o/<slug>/admin/domains` (Batch 1d; tech-lead
 * follow-up B: an automatic canonical promotion reads "Primary address set
 * automatically").
 *
 * PURE. Nothing here reads the database; the caller hands it the audit row's
 * action key and metadata. It shows hostnames and a WHO category only, never an
 * email address, a user id, an IP, or a reason typed by someone else's operator
 * beyond what the church is already told (a force-release reason is told to the
 * church's administrators by design, but is not repeated in this list). The
 * proof token is in no audit row, so it cannot appear (asserted in service
 * tests).
 */

export type ActivityWho = "team" | "support" | "automatic";

export interface ActivityItem {
  id: string;
  /** ISO. */
  at: string;
  text: string;
  who: ActivityWho;
}

export interface ActivityRow {
  id: string;
  action: string;
  createdAt: Date;
  metadata: unknown;
}

function meta(row: ActivityRow): Record<string, unknown> {
  return typeof row.metadata === "object" && row.metadata !== null && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {};
}

function host(value: unknown): string {
  if (typeof value !== "string" || value === "") return "a domain";
  try {
    return domainToUnicode(value) || value;
  } catch {
    return value;
  }
}

export function activityWho(row: ActivityRow): ActivityWho {
  const kind = meta(row).actorKind;
  if (kind === "platform") return "support";
  if (kind === "machine") return "automatic";
  return "team";
}

/** "a", "a and b", "a, b and c". */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "a domain";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * One line per audit action; null for an action this list does not show.
 * `hostnames` lets a caller name several hosts that were changed together (the
 * apex and its www twin), instead of one near-duplicate line per host.
 */
export function activityText(row: ActivityRow, hostnames?: readonly string[]): string | null {
  const m = meta(row);
  const h = hostnames && hostnames.length > 0 ? listOf(hostnames.map(host)) : host(m.hostname);
  const plural = hostnames !== undefined && hostnames.length > 1;
  const was = plural ? "were" : "was";
  const is = plural ? "are" : "is";
  switch (row.action) {
    case "domain.claimed":
      return `${h} ${was} added.`;
    case "domain.proof_verified":
      return `Ownership of ${h} ${was} confirmed.`;
    case "domain.attach_requested":
      return `Connecting ${h} began.`;
    case "domain.attached":
      return `${h} ${was} connected. Securing ${plural ? "them" : "it"} with HTTPS.`;
    case "domain.live":
      return `${h} went live.`;
    case "domain.live_lost":
      return `${h} stopped answering with your site.`;
    case "domain.lapsed":
      return `We could no longer find the ownership record for ${h}.`;
    case "domain.recovered":
      return `The ownership record for ${h} came back.`;
    case "domain.parked":
      return `${h} ${was} removed and ${is} being held while you clean up your DNS.`;
    case "domain.reconnected":
      return `${h} ${was} reconnected.`;
    case "domain.release_requested":
      return `${h} ${is} being released.`;
    case "domain.released":
      return `${h} ${was} released.`;
    case "domain.expired":
      return `The claim on ${h} expired before its ownership record was found.`;
    case "domain.canonical_changed": {
      if (m.reason === "no_canonical") return `Primary address set automatically: ${host(m.toHostname)}.`;
      return `Primary address changed to ${host(m.toHostname)}.`;
    }
    case "domain.hold_set":
      return m.hold === "disputed"
        ? `${h} ${was} placed under review by PresbyPortal support.`
        : `${h} ${was} paused by PresbyPortal support.`;
    case "domain.hold_cleared":
      return `${h} ${was} resumed by PresbyPortal support.`;
    default:
      return null;
  }
}

/** Rows this close together, for the same action and actor, are one event (the apex and www twins move together). */
const SAME_EVENT_WINDOW_MS = 5_000;

/**
 * Maps audit rows to list items, newest first, dropping anything the list does
 * not show. A claim moves its apex and `www.` twin in one step and writes a row
 * for each, so rows of the same action by the same kind of actor within a few
 * seconds are merged into ONE line naming both hosts, not two near-duplicates.
 * A canonical change is never merged (its two hosts are a from and a to).
 */
export function buildActivity(rows: readonly ActivityRow[]): ActivityItem[] {
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const groups: Array<{ first: ActivityRow; hosts: string[] }> = [];
  for (const row of sorted) {
    const m = meta(row);
    const hostname = typeof m.hostname === "string" ? m.hostname : null;
    const mergeable = hostname !== null && row.action !== "domain.canonical_changed";
    const last = groups[groups.length - 1];
    if (
      mergeable &&
      last &&
      last.first.action === row.action &&
      activityWho(last.first) === activityWho(row) &&
      last.first.createdAt.getTime() - row.createdAt.getTime() <= SAME_EVENT_WINDOW_MS &&
      last.hosts.length > 0 &&
      !last.hosts.includes(hostname)
    ) {
      last.hosts.push(hostname);
      continue;
    }
    groups.push({ first: row, hosts: mergeable ? [hostname] : [] });
  }
  const items: ActivityItem[] = [];
  for (const g of groups) {
    const text = activityText(g.first, g.hosts.length > 1 ? [...g.hosts].sort(byHostLength) : undefined);
    if (text === null) continue;
    items.push({ id: g.first.id, at: g.first.createdAt.toISOString(), text, who: activityWho(g.first) });
  }
  return items;
}

/** The bare domain before its `www.` twin. */
function byHostLength(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

export const ACTIVITY_WHO_LABEL: Record<ActivityWho, string> = {
  team: "Your team",
  support: "PresbyPortal support",
  automatic: "Automatic check",
};
