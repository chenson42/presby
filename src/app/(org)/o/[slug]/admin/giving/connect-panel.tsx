"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { useHydrated } from "@/components/shared/use-hydrated";
import type { ConnectionPanel } from "@/lib/giving/connection";
import { deriveDisplayState, isOpenState, primaryActionFor } from "@/lib/giving/connection-display";
import {
  ATTEST_DIALOG,
  CONNECT_ACTION_LABELS as LABEL,
  GO_LIVE_ITEMS,
  TAKE_OFFLINE_DIALOG,
  disconnectDialogBody,
} from "@/lib/giving/giving-copy";
import { isOnboardingUrl } from "@/lib/giving/providers/stripe/urls";
import {
  attestPayoutsAction,
  continueConnectAction,
  disconnectAction,
  refreshConnectionAction,
  setPublicPageAction,
  startConnectAction,
} from "./connect/actions";
import { RatesForm } from "./rates-form";

/**
 * The connection card's controls - docs/work-log/2026-10-15-online-giving.md,
 * Batch 3b. One primary action per state (see `connection-display.ts`), the
 * secondary actions beside it, and an `AlertDialog` for every act that is hard
 * to take back: disconnect (after showing how many monthly gifts keep charging),
 * taking the give page offline, and the payouts attestation.
 *
 * REDIRECTS. Start and Continue return a Stripe URL. The server already
 * asserted its origin; this asserts it AGAIN (`isOnboardingUrl`: exact host,
 * https, no userinfo or port) before `window.location.assign`, so a tampered
 * response can never send a treasurer anywhere else. The page is left in its
 * pending state on purpose - the browser is already leaving.
 *
 * Plain `onClick` controls render disabled until hydrated (F129). Failures toast
 * the action's own sentence; a 2FA refusal navigates to the challenge; a
 * `not_ready` go-live names what is missing under the button as well.
 */

type Busy = null | "start" | "continue" | "refresh" | "attest" | "golive" | "offline" | "disconnect";

export function ConnectPanel({ slug, panel }: { slug: string; panel: ConnectionPanel }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState<Busy>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [attestOpen, setAttestOpen] = useState(false);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [notReady, setNotReady] = useState<string[]>([]);

  const display = deriveDisplayState(panel);
  const primary = primaryActionFor(display);
  const open = isOpenState(display);
  const c = panel.connection;
  const disabled = !hydrated || busy !== null;

  /** Common failure handling; returns true when the caller should stop. */
  function failed(result: { ok: boolean; error?: string; kind?: string; redirectTo?: string }): boolean {
    if (result.ok) return false;
    if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
      return true;
    }
    toast.error(result.error ?? "Something went wrong. Nothing was changed.");
    return true;
  }

  function goToStripe(url: string): boolean {
    if (!isOnboardingUrl(url)) {
      toast.error("We got an unexpected address back from Stripe, so we didn't open it. Nothing was changed.");
      return false;
    }
    window.location.assign(url);
    return true;
  }

  async function connect(kind: "start" | "continue") {
    setBusy(kind);
    const result = kind === "start" ? await startConnectAction(slug) : await continueConnectAction(slug);
    if (failed(result)) {
      setBusy(null);
      // A connection may now exist even though the link failed: show it.
      if (!result.ok && result.kind === "provider_error") router.refresh();
      return;
    }
    if (result.ok && result.data?.kind === "redirect" && goToStripe(result.data.url)) return; // leaving the page
    setBusy(null);
  }

  async function refresh() {
    setBusy("refresh");
    const result = await refreshConnectionAction(slug);
    setBusy(null);
    if (failed(result)) return;
    if (result.ok) {
      toast.success(result.data?.outcome === "noop" ? "Nothing has changed at Stripe." : "Status updated from Stripe.");
      router.refresh();
    }
  }

  async function attest() {
    setBusy("attest");
    const result = await attestPayoutsAction(slug);
    setBusy(null);
    setAttestOpen(false);
    if (failed(result)) return;
    toast.success("Thank you. Automatic payouts confirmed.");
    setNotReady([]);
    router.refresh();
  }

  async function setPublic(enabled: boolean) {
    setBusy(enabled ? "golive" : "offline");
    const result = await setPublicPageAction(slug, enabled);
    setBusy(null);
    setOfflineOpen(false);
    if (!result.ok && result.kind === "not_ready") {
      setNotReady(result.missing ?? []);
      toast.error(result.error);
      return;
    }
    if (failed(result)) return;
    setNotReady([]);
    toast.success(enabled ? "The give page is on." : "The give page is off.");
    router.refresh();
  }

  async function disconnect() {
    setBusy("disconnect");
    const result = await disconnectAction(slug);
    setBusy(null);
    setDisconnectOpen(false);
    if (failed(result)) return;
    toast.success("Stripe disconnected. Gifts already recorded are unchanged.");
    router.refresh();
  }

  if (display === "unconfigured") return null;

  const primaryButton = (() => {
    switch (primary) {
      case "start":
        return (
          <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={disabled} onClick={() => connect("start")}>
            {busy === "start" ? "Opening Stripe…" : LABEL.start}
          </Button>
        );
      case "reconnect":
        return (
          <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={disabled} onClick={() => connect("start")}>
            {busy === "start" ? "Opening Stripe…" : LABEL.reconnect}
          </Button>
        );
      case "continue":
        return (
          <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={disabled} onClick={() => connect("continue")}>
            {busy === "continue" ? "Opening Stripe…" : LABEL.continue}
          </Button>
        );
      case "refresh":
        return (
          <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={disabled} onClick={refresh}>
            {busy === "refresh" ? "Checking…" : LABEL.refresh}
          </Button>
        );
      default:
        return null;
    }
  })();

  const attested = c?.payoutsAttestedAt != null;
  const publicOn = c?.publicEnabledAt != null;

  return (
    <div className="space-y-4" data-testid="connect-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {primaryButton}

        {open && primary !== "refresh" && (
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={disabled} onClick={refresh}>
            {busy === "refresh" ? "Checking…" : LABEL.refresh}
          </Button>
        )}
        {display === "pending_verification" && (
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={disabled} onClick={() => connect("continue")}>
            {busy === "continue" ? "Opening Stripe…" : LABEL.review}
          </Button>
        )}

        {display === "active" && !attested && (
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={disabled} onClick={() => setAttestOpen(true)}>
            {LABEL.attest}
          </Button>
        )}
        {display === "active" && !publicOn && (
          <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={disabled} onClick={() => setPublic(true)}>
            {busy === "golive" ? "Turning on…" : LABEL.goLive}
          </Button>
        )}
        {display === "active" && publicOn && (
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={disabled} onClick={() => setOfflineOpen(true)}>
            {LABEL.takeOffline}
          </Button>
        )}
        {display === "active" && (
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={disabled} onClick={() => setRatesOpen((v) => !v)} aria-expanded={ratesOpen}>
            {ratesOpen ? "Close fee rates" : LABEL.editRates}
          </Button>
        )}

        {open && (
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={disabled} onClick={() => setDisconnectOpen(true)}>
            {LABEL.disconnect}
          </Button>
        )}
      </div>

      {notReady.length > 0 && (
        <div role="alert" className="rounded-lg border border-border bg-muted p-3 text-sm" data-testid="not-ready">
          <p className="font-medium">The give page can&apos;t go live yet. Still needed:</p>
          <ul className="mt-1 list-disc pl-5">
            {notReady.map((key) => (
              <li key={key}>{GO_LIVE_ITEMS[key] ?? key}</li>
            ))}
          </ul>
        </div>
      )}

      {ratesOpen && c && display === "active" && (
        <HydrationGate>
          <div className="rounded-lg border border-border p-4">
            <RatesForm slug={slug} rates={c.rates} onDone={() => setRatesOpen(false)} />
          </div>
        </HydrationGate>
      )}

      <AlertDialog open={attestOpen} onOpenChange={setAttestOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ATTEST_DIALOG.title}</AlertDialogTitle>
            <AlertDialogDescription>{ATTEST_DIALOG.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "attest"}>{ATTEST_DIALOG.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy === "attest"}
              onClick={(event) => {
                event.preventDefault();
                void attest();
              }}
            >
              {busy === "attest" ? "Saving…" : ATTEST_DIALOG.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={offlineOpen} onOpenChange={setOfflineOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{TAKE_OFFLINE_DIALOG.title}</AlertDialogTitle>
            <AlertDialogDescription>{TAKE_OFFLINE_DIALOG.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "offline"}>{TAKE_OFFLINE_DIALOG.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy === "offline"}
              onClick={(event) => {
                event.preventDefault();
                void setPublic(false);
              }}
            >
              {busy === "offline" ? "Taking offline…" : TAKE_OFFLINE_DIALOG.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Stripe?</AlertDialogTitle>
            <AlertDialogDescription data-testid="disconnect-body">
              {disconnectDialogBody(panel.activeSchedules)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "disconnect"}>Keep it connected</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy === "disconnect"}
              onClick={(event) => {
                event.preventDefault();
                void disconnect();
              }}
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect Stripe"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
