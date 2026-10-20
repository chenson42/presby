import type { HostingProvider } from "./adapters/hosting";

/**
 * reattach.ts - the bulk re-attach, for the day the platform's Vercel project
 * changes (Phase 2 R7 / G12: a project move re-attaches every domain; the
 * adapter must support a runbook for it). The logic lives here so it is
 * unit-tested; `scripts/domains/reattach.ts` is the thin command-line wrapper
 * that reads the rows and builds the real provider.
 *
 * WHICH HOSTS. Exactly the hosts the database believes are attached to the
 * provider: `attached`, `live`, `lapsed` (a lapsed host stays attached through
 * its grace) and `parked` (a removed host stays attached and dark through its
 * grace). Not `attach_pending` (the sweep attaches those on its own), not
 * `release_pending` (those are being detached), not pending/verified (never
 * attached), not terminal.
 *
 * IDEMPOTENT AND READ-ONLY IN THE DATABASE. The provider's add is idempotent
 * (a host already on the project is "already on the project"), so the script
 * can be re-run safely, and it writes nothing to `organization_domains` - the
 * rows already say what should be attached; this makes the new project agree.
 * It defaults to a DRY RUN that lists what it would do and calls nothing.
 *
 * Output names hosts (an operator's terminal, never a log sink) and outcome
 * classes only; provider text never appears (the adapter never returns it).
 */

export const REATTACH_STATES = ["attached", "live", "lapsed", "parked"] as const;

export interface ReattachRow {
  hostname: string;
  state: string;
}

export type ReattachOutcome = "attached" | "already_attached" | "blocked" | "retryable" | "config_error" | "rejected";

export interface ReattachReport {
  apply: boolean;
  total: number;
  byOutcome: Record<string, number>;
  /** Hosts that did not end up attached, with the outcome class. */
  failed: Array<{ hostname: string; outcome: ReattachOutcome }>;
  /** True when the run stopped early because the provider's credentials are wrong (every further call would fail the same way). */
  aborted: boolean;
}

export interface ReattachOptions {
  /** Without this, nothing is called: the report lists what WOULD be attached. */
  apply: boolean;
  /** Pause between provider calls (default 250 ms), to stay clear of rate limits. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export async function reattachAll(
  rows: readonly ReattachRow[],
  hosting: HostingProvider,
  options: ReattachOptions,
): Promise<ReattachReport> {
  const log = options.log ?? (() => {});
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delayMs = options.delayMs ?? 250;

  const hosts = [
    ...new Set(
      rows
        .filter((r) => (REATTACH_STATES as readonly string[]).includes(r.state))
        .map((r) => r.hostname),
    ),
  ].sort();

  const report: ReattachReport = { apply: options.apply, total: hosts.length, byOutcome: {}, failed: [], aborted: false };
  log(`${options.apply ? "APPLY" : "DRY RUN"}: ${hosts.length} host(s) to ensure are attached`);

  for (const hostname of hosts) {
    if (!options.apply) {
      log(`would attach ${hostname}`);
      continue;
    }
    const result = await hosting.addDomain(hostname);
    let outcome: ReattachOutcome;
    switch (result.kind) {
      case "ok":
        outcome = "attached";
        break;
      case "already_on_project":
        outcome = "already_attached";
        break;
      case "blocked":
        outcome = "blocked";
        break;
      case "retryable":
        outcome = "retryable";
        break;
      case "config_error":
        outcome = "config_error";
        break;
      case "rejected":
        outcome = "rejected";
        break;
    }
    report.byOutcome[outcome] = (report.byOutcome[outcome] ?? 0) + 1;
    log(`${outcome.padEnd(16)} ${hostname}`);
    if (outcome !== "attached" && outcome !== "already_attached") report.failed.push({ hostname, outcome });
    if (outcome === "config_error") {
      report.aborted = true;
      log("stopping: the provider refused our credentials or project settings; every call would fail the same way");
      break;
    }
    if (delayMs > 0) await sleep(delayMs);
  }
  return report;
}
