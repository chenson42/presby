import type { ConnectDisplayState } from "./giving-copy";

/**
 * Pure derivation of what the connection card shows, from the panel
 * projection `loadConnectionPanel()` returns (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 3a "Contract for 3b"). No server-only, no
 * database: the server card and the client panel both read it, and it is
 * unit-tested over every state.
 *
 * The panel's own `state` has six values; the work-log's six USER states split
 * `onboarding` in two by what the person must do next:
 *   details_due           Stripe still needs something from them -> Continue
 *   pending_verification  they have sent it all; Stripe is checking -> Refresh
 */

/** The structural subset of `ConnectionPanel` this reads (all JSON-safe). */
export interface PanelLike {
  state: "unconfigured" | "none" | "onboarding" | "restricted" | "active" | "disconnected";
  connection: null | {
    status: string;
    detailsSubmitted: boolean;
    requirementsDue: boolean;
  };
}

export function deriveDisplayState(panel: PanelLike): ConnectDisplayState {
  switch (panel.state) {
    case "unconfigured":
      return "unconfigured";
    case "none":
      return "not_started";
    case "active":
      return "active";
    case "restricted":
      return "restricted";
    case "disconnected":
      return "disconnected";
    case "onboarding": {
      const c = panel.connection;
      return c && c.detailsSubmitted && !c.requirementsDue ? "pending_verification" : "details_due";
    }
  }
}

/** The one primary action per state; everything else is secondary. */
export type PrimaryAction = "start" | "reconnect" | "continue" | "refresh" | "none";

export function primaryActionFor(state: ConnectDisplayState): PrimaryAction {
  switch (state) {
    case "not_started":
      return "start";
    case "disconnected":
      return "reconnect";
    case "details_due":
    case "restricted":
      return "continue";
    case "pending_verification":
      return "refresh";
    case "active":
    case "unconfigured":
      return "none";
  }
}

/** True while there is an open connection a treasurer can refresh, continue or disconnect. */
export function isOpenState(state: ConnectDisplayState): boolean {
  return state === "details_due" || state === "pending_verification" || state === "restricted" || state === "active";
}
