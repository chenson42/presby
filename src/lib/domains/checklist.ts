import { domainToUnicode } from "node:url";
import { proofRecordName, proofRecordValue } from "./proof";
import {
  isTerminal,
  type DomainPurpose,
  type DomainState,
} from "./state";

/**
 * checklist.ts - the view-model the domains pages render (Phase 3 API
 * Contract section 1; Component / Page Plan; G11, G29, G30, G31). PURE: it
 * turns stored rows plus their last `observation` into steps, records with
 * per-record status, and banners, with no I/O, so the copy and the state logic
 * are unit-tested without a browser. (`node:url` is used only for the Unicode
 * display name; this module is for Server Components.)
 *
 * NEVER PROVIDER TEXT (G30). Every message here is ours: a Vercel or Resend
 * error string is never shown, and a DNS lookup that failed reads "We couldn't
 * check right now", never "missing" - `unknown` is its own status.
 *
 * Batch 1a-ii renders the PROOF record. The routing records (A / CNAME to
 * Vercel's targets) appear once Batch 1b's hosting adapter has written
 * `observation.targets`, and their statuses once its checks have written
 * `observation.routing`; this module already knows how to show both.
 */

export type RecordStatus = "correct" | "missing" | "wrong_value" | "conflicting" | "unknown";

export type RecordHint =
  | "keep_record"
  | "apex_alias"
  | "proxied"
  | "leftover_aaaa"
  | "caa"
  | "dnssec";

/**
 * What the service stores in `organization_domains.observation` (jsonb). Every
 * field optional: a row may never have been checked. Each ROW stores its own
 * view (its own routing result, its own streaks); the checklist merges the
 * group's rows, so a sweep that checks only the rows that were due never leaves
 * another row's result stale or missing.
 */
export interface DomainObservation {
  checkedAt?: string;
  proof?: { status?: "present" | "absent" | "wrong_value" | "unknown" };
  /**
   * The provider's recommended DNS targets, cached so the checklist never needs
   * the provider to render. `source: "generic"` marks the fallback used when
   * the provider's recommendation has never been readable.
   */
  targets?: { cname?: string | null; ipv4?: string[]; source?: "provider" | "generic" };
  /** This row's routing result (written for its own hostname). */
  routing?: {
    records?: Array<{
      hostname: string;
      status: RecordStatus;
      hint?: RecordHint | null;
      /** The host is a zone apex: instruct A / ALIAS, never CNAME. */
      apex?: boolean | null;
    }>;
  };
  /** The last live-ness probe outcome. */
  probe?: { status?: "ack" | "negative" | "unknown"; at?: string };
  /** ISO time of the first miss of the current proof streak (debounce.ts). */
  proofMissSince?: string;
  /** Consecutive failed provider attempts in the current state (drives the backoff). */
  attempts?: number;
  /** ISO time the current run of provider failures began (the 24 hour operator alert). */
  failingSince?: string;
}

/** Reads the stored jsonb defensively: anything unexpected is "no observation". */
export function readObservation(value: unknown): DomainObservation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as DomainObservation;
}

/** The slice of an `organization_domains` row the checklist needs. */
export interface ChecklistRow {
  id: string;
  hostname: string;
  claimName: string;
  purpose: DomainPurpose;
  webRole: "canonical" | "alias" | null;
  state: DomainState;
  platformHold: "paused" | "disputed" | null;
  proofToken: string;
  lastCheckedAt: Date | null;
  lastCheckClass: string | null;
  expiresAt: Date;
  graceEndsAt: Date | null;
  observation: unknown;
  /** Vercel's own verification TXT, when the name lives in another account of theirs. */
  providerChallenge?: unknown;
}

export interface ChecklistContext {
  /** Organization site status from `presby_current_org_site_status()`; null when unknown. */
  siteStatus: string | null;
  /** The slug URL the site keeps serving from, e.g. `presbyportal.invalid/site/alder-creek`. */
  platformSiteUrl: string;
}

export type BannerCode =
  | "provider_unavailable"
  | "lookup_failed"
  | "held_elsewhere"
  | "blocked_at_host"
  | "config_error"
  | "paused"
  | "disputed"
  | "lapsed"
  | "parked"
  | "releasing"
  | "securing"
  | "preflight_site_not_live"
  | "keep_txt"
  | "claim_expires";

export interface ChecklistBanner {
  code: BannerCode;
  tone: "info" | "warning" | "error";
  message: string;
}

export interface ChecklistRecord {
  /** `provider` is the hosting provider's own ownership challenge (a name already in another of its accounts). */
  kind: "proof" | "routing" | "provider";
  type: "TXT" | "A" | "CNAME";
  /** The DNS name to create the record at. */
  name: string;
  value: string;
  status: RecordStatus;
  hint: RecordHint | null;
  /** Show "Keep this record in place" beside it. */
  keep: boolean;
}

export const STEP_LABELS = [
  "Prove you own it",
  "Connect it",
  "Secure it (HTTPS)",
  "Live",
] as const;

export type GroupPhase =
  | "proving"
  | "connecting"
  | "securing"
  | "live"
  | "lapsed"
  | "parked"
  | "releasing";

export interface ChecklistHost {
  id: string;
  hostname: string;
  displayHostname: string;
  role: "canonical" | "alias" | null;
  state: DomainState;
}

export interface ChecklistGroup {
  claimName: string;
  displayName: string;
  purpose: DomainPurpose;
  hosts: ChecklistHost[];
  phase: GroupPhase;
  /** 1-4 while proving or connecting; 0 when lapsed, parked or releasing. */
  step: 0 | 1 | 2 | 3 | 4;
  steps: Array<{ n: 1 | 2 | 3 | 4; label: string; state: "done" | "current" | "todo" }>;
  records: ChecklistRecord[];
  banners: ChecklistBanner[];
  lastCheckedAt: string | null;
  /** ISO. Set while the claim is still pending: it expires if never proven. */
  claimExpiresAt: string | null;
  graceEndsAt: string | null;
  /** The weekly "records still point at us" offboarding card applies. */
  offboarding: boolean;
  canCheck: boolean;
  canRemove: boolean;
  canReconnect: boolean;
}

const PROGRESS: Partial<Record<DomainState, 1 | 2 | 3 | 4>> = {
  pending: 1,
  verified: 2,
  attach_pending: 2,
  attached: 3,
  live: 4,
};

const CHECKABLE: ReadonlySet<DomainState> = new Set([
  "pending",
  "verified",
  "attach_pending",
  "attached",
  "live",
  "lapsed",
]);

function banner(
  code: BannerCode,
  tone: ChecklistBanner["tone"],
  message: string,
): ChecklistBanner {
  return { code, tone, message };
}

function dateLabel(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function proofStatus(obs: DomainObservation): RecordStatus {
  switch (obs.proof?.status) {
    case "present":
      return "correct";
    case "absent":
      return "missing";
    case "wrong_value":
      return "wrong_value";
    default:
      return "unknown";
  }
}

/** The newest observation among a group's rows: the group shares one proof, but each row is checked on its own schedule. */
function newestObservation(rows: ChecklistRow[]): DomainObservation {
  const observations = rows.map((r) => readObservation(r.observation));
  return (
    [...observations].sort((a, b) => (b.checkedAt ?? "").localeCompare(a.checkedAt ?? ""))[0] ?? {}
  );
}

function providerChallengeRecords(rows: ChecklistRow[]): ChecklistRecord[] {
  const seen = new Set<string>();
  const out: ChecklistRecord[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.providerChallenge)) continue;
    for (const raw of row.providerChallenge) {
      if (typeof raw !== "object" || raw === null) continue;
      const c = raw as { type?: unknown; domain?: unknown; value?: unknown };
      if (typeof c.domain !== "string" || typeof c.value !== "string") continue;
      const type = typeof c.type === "string" ? c.type.toUpperCase() : "TXT";
      const key = `${type} ${c.domain} ${c.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: "provider",
        type: type === "A" || type === "CNAME" ? type : "TXT",
        name: c.domain,
        value: c.value,
        status: "unknown",
        hint: null,
        keep: true,
      });
    }
  }
  return out;
}

function routingRecords(rows: ChecklistRow[]): ChecklistRecord[] {
  if (rows[0]?.purpose !== "web") return [];
  // The recommendation is the same for the whole group; take the newest that has one.
  const targets = [...rows]
    .map((r) => readObservation(r.observation))
    .sort((a, b) => (b.checkedAt ?? "").localeCompare(a.checkedAt ?? ""))
    .find((o) => o.targets)?.targets;
  if (!targets) return [];
  const out: ChecklistRecord[] = [];
  for (const row of rows) {
    if (row.state === "pending" || row.state === "verified") continue;
    // A row's routing result lives on the row itself.
    const result = readObservation(row.observation).routing?.records?.find((r) => r.hostname === row.hostname);
    const isWww = row.hostname.startsWith("www.");
    // A zone apex cannot hold a CNAME; a subdomain should. The SOA check says
    // which; until it has run, `www.` is the subdomain and the rest are apexes.
    const wantsAddress = result?.apex ?? !isWww;
    if (!wantsAddress) {
      if (!targets.cname) continue;
      out.push({
        kind: "routing",
        type: "CNAME",
        name: row.hostname,
        value: targets.cname,
        status: result?.status ?? "unknown",
        hint: result?.hint ?? null,
        keep: false,
      });
    } else {
      for (const ip of targets.ipv4 ?? []) {
        out.push({
          kind: "routing",
          type: "A",
          name: row.hostname,
          value: ip,
          status: result?.status ?? "unknown",
          hint: result?.hint ?? "apex_alias",
          keep: false,
        });
      }
    }
  }
  return out;
}

/**
 * Groups the organization's NON-TERMINAL rows by `claim_name` and builds what
 * the page renders for each. Terminal rows (`released`, `expired`) are history
 * and are not part of the checklist.
 */
export function buildChecklist(
  rows: readonly ChecklistRow[],
  ctx: ChecklistContext,
): ChecklistGroup[] {
  const live = rows.filter((r) => !isTerminal(r.state));
  const byClaim = new Map<string, ChecklistRow[]>();
  for (const row of live) {
    const group = byClaim.get(row.claimName) ?? [];
    group.push(row);
    byClaim.set(row.claimName, group);
  }

  return [...byClaim.entries()].map(([claimName, group]) => {
    // Canonical first, then apex before www, so the page order is stable.
    group.sort((a, b) => {
      const role = (r: ChecklistRow) => (r.webRole === "canonical" ? 0 : 1);
      return role(a) - role(b) || a.hostname.length - b.hostname.length;
    });
    const head = group[0];
    const obs = newestObservation(group);
    const states = group.map((r) => r.state);

    const lowest = Math.min(...states.map((s) => PROGRESS[s] ?? 0));
    const anyLapsed = states.includes("lapsed");
    const anyReleasing = states.includes("release_pending");
    const anyParked = states.includes("parked");
    const phase: GroupPhase = anyReleasing
      ? "releasing"
      : anyParked
        ? "parked"
        : anyLapsed
          ? "lapsed"
          : lowest >= 4
            ? "live"
            : lowest === 3
              ? "securing"
              : lowest === 2
                ? "connecting"
                : "proving";
    const step = (phase === "live" ? 4 : phase === "securing" ? 3 : phase === "connecting" ? 2 : phase === "proving" ? 1 : 0) as ChecklistGroup["step"];

    const steps = ([1, 2, 3, 4] as const).map((n) => ({
      n,
      label: STEP_LABELS[n - 1],
      state: (step === 0 ? "todo" : n < step ? "done" : n === step ? "current" : "todo") as
        | "done"
        | "current"
        | "todo",
    }));

    const records: ChecklistRecord[] = [
      {
        kind: "proof",
        type: "TXT",
        name: proofRecordName(claimName),
        value: proofRecordValue(head.proofToken),
        status: proofStatus(obs),
        hint: "keep_record",
        keep: step >= 2 || phase === "lapsed" || phase === "parked",
      },
      ...routingRecords(group),
      ...providerChallengeRecords(group),
    ];

    const banners: ChecklistBanner[] = [];
    const classes = new Set(group.map((r) => r.lastCheckClass));
    if (classes.has("provider_unavailable")) {
      banners.push(
        banner(
          "provider_unavailable",
          "warning",
          "Connecting is temporarily unavailable. Your DNS changes are safe to make; we'll finish connecting when it's back.",
        ),
      );
    }
    if (classes.has("config_error")) {
      banners.push(
        banner(
          "config_error",
          "warning",
          "Connecting is temporarily unavailable. Your DNS changes are safe to make; we'll finish connecting when it's back.",
        ),
      );
    }
    if (classes.has("dns_unknown")) {
      banners.push(
        banner("lookup_failed", "info", "We couldn't check right now. Try again in a few minutes."),
      );
    }
    if (classes.has("held_elsewhere")) {
      banners.push(
        banner(
          "held_elsewhere",
          "error",
          "This domain is already connected to another organization. Contact support.",
        ),
      );
    }
    if (classes.has("provider_rejected")) {
      banners.push(
        banner(
          "blocked_at_host",
          "error",
          "We couldn't connect this name. Contact support.",
        ),
      );
    }
    if (group.some((r) => r.platformHold === "paused")) {
      banners.push(
        banner(
          "paused",
          "warning",
          `Your domain is paused by PresbyPortal support. Your site is still available at ${ctx.platformSiteUrl}.`,
        ),
      );
    }
    if (group.some((r) => r.platformHold === "disputed")) {
      banners.push(
        banner(
          "disputed",
          "warning",
          `This domain is under review by PresbyPortal support. Your site is still available at ${ctx.platformSiteUrl}.`,
        ),
      );
    }
    if (phase === "lapsed") {
      banners.push(
        banner(
          "lapsed",
          "warning",
          `We can no longer find your verification record. Your site is serving from ${ctx.platformSiteUrl} until it's restored.`,
        ),
      );
    }
    if (phase === "parked") {
      const grace = group.find((r) => r.state === "parked")?.graceEndsAt ?? null;
      banners.push(
        banner(
          "parked",
          "info",
          grace
            ? `This domain was removed. We hold it dark until ${dateLabel(grace)} so no one else can take it over; delete your DNS records before then.`
            : "This domain was removed. We hold it dark for a while so no one else can take it over; delete your DNS records before it is released.",
        ),
      );
    }
    if (phase === "releasing") {
      banners.push(
        banner("releasing", "info", "We're releasing this domain. You can delete its DNS records now."),
      );
    }
    if (phase === "securing") {
      banners.push(banner("securing", "info", "Securing your site... this usually takes a few minutes."));
    }
    if (
      ctx.siteStatus !== null &&
      ctx.siteStatus !== "live" &&
      (phase === "proving" || phase === "connecting" || phase === "securing")
    ) {
      banners.push(
        banner(
          "preflight_site_not_live",
          "warning",
          "Your site isn't published yet. Point your domain here after it is.",
        ),
      );
    }
    if (step >= 2) {
      banners.push(
        banner(
          "keep_txt",
          "info",
          "Keep this record in place; it protects your domain from being claimed by someone else.",
        ),
      );
    }

    const pendingRows = group.filter((r) => r.state === "pending");
    const claimExpiresAt =
      pendingRows.length > 0
        ? new Date(Math.min(...pendingRows.map((r) => r.expiresAt.getTime()))).toISOString()
        : null;
    if (claimExpiresAt !== null) {
      banners.push(
        banner(
          "claim_expires",
          "info",
          `Publish this record by ${claimExpiresAt.slice(0, 10)}, or the claim expires and you can start again.`,
        ),
      );
    }

    const checked = group
      .map((r) => r.lastCheckedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      claimName,
      displayName: domainToUnicode(claimName),
      purpose: head.purpose,
      hosts: group.map((r) => ({
        id: r.id,
        hostname: r.hostname,
        displayHostname: domainToUnicode(r.hostname),
        role: r.webRole,
        state: r.state,
      })),
      phase,
      step,
      steps,
      records,
      banners,
      lastCheckedAt: checked ? checked.toISOString() : null,
      claimExpiresAt,
      graceEndsAt:
        group
          .map((r) => r.graceEndsAt)
          .filter((d): d is Date => d !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0]
          ?.toISOString() ?? null,
      offboarding: phase === "lapsed" || phase === "parked" || phase === "releasing",
      canCheck: group.some((r) => CHECKABLE.has(r.state)),
      canRemove: group.some((r) => r.state !== "parked" && r.state !== "release_pending"),
      canReconnect: group.some((r) => r.state === "parked"),
    };
  });
}
