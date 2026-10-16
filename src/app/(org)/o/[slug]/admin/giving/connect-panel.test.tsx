// @vitest-environment jsdom
/**
 * The connection panel's behaviour (docs/work-log/2026-10-15-online-giving.md,
 * Batch 3b): the Stripe redirect and its client-side origin re-assertion, the
 * AlertDialogs (disconnect shows the monthly-gift count first, take-offline,
 * attest), not_ready naming what is missing, failure toasts and the 2FA bounce.
 * No native dialog is ever used.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  startConnectAction: vi.fn(),
  continueConnectAction: vi.fn(),
  refreshConnectionAction: vi.fn(),
  attestPayoutsAction: vi.fn(),
  setPublicPageAction: vi.fn(),
  disconnectAction: vi.fn(),
  updateRatesAction: vi.fn(),
}));
vi.mock("./connect/actions", () => actions);
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { ConnectPanel } from "./connect-panel";
import { panelOf } from "./connect-fixtures";

const assign = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  for (const fn of [...Object.values(actions), refresh, toastSuccess, toastError, assign]) fn.mockReset();
});

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));

describe("ConnectPanel - redirects", () => {
  it("Connect Stripe sends the browser to the onboarding URL after re-asserting its origin", async () => {
    actions.startConnectAction.mockResolvedValue({ ok: true, data: { kind: "redirect", url: "https://accounts.stripe.com/r/acct_fixture1" } });
    render(<ConnectPanel slug="alder-creek" panel={panelOf("none")} />);
    click("Connect Stripe");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.stripe.com/r/acct_fixture1"));
    expect(actions.startConnectAction).toHaveBeenCalledWith("alder-creek");
  });

  it("accepts connect.stripe.com too (the v1 host)", async () => {
    actions.continueConnectAction.mockResolvedValue({ ok: true, data: { kind: "redirect", url: "https://connect.stripe.com/setup/e/acct_fixture1/abc" } });
    render(<ConnectPanel slug="s" panel={panelOf("onboarding")} />);
    click("Continue setup");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://connect.stripe.com/setup/e/acct_fixture1/abc"));
  });

  it.each([
    "https://accounts.stripe.com.evil.example/r/x",
    "https://evil.example/https://accounts.stripe.com/",
    "https://accounts.stripe.com@evil.example/", // leak-ok: hostile userinfo URL test input, not an email
    "http://accounts.stripe.com/r/x",
    "https://checkout.stripe.com/c/pay/x",
    "javascript:alert(1)",
  ])("a tampered response %s never navigates; the treasurer is told, and nothing is opened", async (url) => {
    actions.startConnectAction.mockResolvedValue({ ok: true, data: { kind: "redirect", url } });
    render(<ConnectPanel slug="s" panel={panelOf("none")} />);
    click("Connect Stripe");
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]![0]).toMatch(/unexpected address back from Stripe/);
    expect(assign).not.toHaveBeenCalled();
    // and the button recovers
    await waitFor(() => expect((screen.getByRole("button", { name: "Connect Stripe" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("a provider error toasts the action's own sentence, re-enables the button and refreshes (a connection may now exist)", async () => {
    actions.startConnectAction.mockResolvedValue({ ok: false, kind: "provider_error", error: "We couldn't reach Stripe. Nothing was changed." });
    render(<ConnectPanel slug="s" panel={panelOf("none")} />);
    click("Connect Stripe");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("We couldn't reach Stripe. Nothing was changed."));
    expect(refresh).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("a 2FA refusal sends the user to the challenge, not a toast", async () => {
    actions.startConnectAction.mockResolvedValue({ ok: false, kind: "two_factor_required", redirectTo: "/totp?callbackUrl=%2Fo%2Fs%2Fadmin%2Fgiving", error: "x" });
    render(<ConnectPanel slug="s" panel={panelOf("none")} />);
    click("Connect Stripe");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/totp?callbackUrl=%2Fo%2Fs%2Fadmin%2Fgiving"));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("Connect a new Stripe account (after a disconnect) starts a fresh connection", async () => {
    actions.startConnectAction.mockResolvedValue({ ok: true, data: { kind: "redirect", url: "https://accounts.stripe.com/r/acct_fixture2" } });
    render(<ConnectPanel slug="s" panel={panelOf("disconnected")} />);
    click("Connect a new Stripe account");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.stripe.com/r/acct_fixture2"));
  });
});

describe("ConnectPanel - refresh", () => {
  it("reports a change and a no-op differently, and refreshes the page", async () => {
    actions.refreshConnectionAction.mockResolvedValueOnce({ ok: true, data: { outcome: "applied:status_changed", status: {} } });
    render(<ConnectPanel slug="s" panel={panelOf("onboarding")} />);
    click("Refresh status");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Status updated from Stripe."));
    expect(refresh).toHaveBeenCalled();
    actions.refreshConnectionAction.mockResolvedValueOnce({ ok: true, data: { outcome: "noop", status: {} } });
    click("Refresh status");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Nothing has changed at Stripe."));
  });

  it("a Stripe outage on refresh toasts the error and changes nothing", async () => {
    actions.refreshConnectionAction.mockResolvedValue({ ok: false, kind: "provider_error", error: "We couldn't reach Stripe. Nothing was changed." });
    render(<ConnectPanel slug="s" panel={panelOf("onboarding")} />);
    click("Refresh status");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("We couldn't reach Stripe. Nothing was changed."));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("ConnectPanel - disconnect", () => {
  it("opens an AlertDialog (never a native confirm) that states the active monthly-gift count BEFORE anything is called", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<ConnectPanel slug="s" panel={panelOf("active", { activeSchedules: 3 })} />);
    click("Disconnect");
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByTestId("disconnect-body").textContent).toMatch(/3 monthly gifts are still active in Stripe\. They keep charging/);
    expect(within(dialog).getByTestId("disconnect-body").textContent).toMatch(/connect a new Stripe account/);
    expect(actions.disconnectAction).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("says so when no monthly gift is active, and 'Keep it connected' calls nothing", async () => {
    render(<ConnectPanel slug="s" panel={panelOf("active", { activeSchedules: 0 })} />);
    click("Disconnect");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/No monthly gifts are active right now/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it connected" }));
    expect(actions.disconnectAction).not.toHaveBeenCalled();
  });

  it("confirming calls the action once, toasts and refreshes", async () => {
    actions.disconnectAction.mockResolvedValue({ ok: true, data: { activeSchedules: 1 } });
    render(<ConnectPanel slug="alder-creek" panel={panelOf("active", { activeSchedules: 1 })} />);
    click("Disconnect");
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect Stripe" }));
    await waitFor(() => expect(actions.disconnectAction).toHaveBeenCalledWith("alder-creek"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Stripe disconnected. Gifts already recorded are unchanged."));
    expect(refresh).toHaveBeenCalled();
    expect(actions.disconnectAction).toHaveBeenCalledTimes(1);
  });

  it("a failed disconnect toasts the reason and leaves things as they were", async () => {
    actions.disconnectAction.mockResolvedValue({ ok: false, kind: "no_connection", error: "There's no Stripe connection to do that with." });
    render(<ConnectPanel slug="s" panel={panelOf("active")} />);
    click("Disconnect");
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect Stripe" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("There's no Stripe connection to do that with."));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("ConnectPanel - going live and offline", () => {
  it("Turn on the give page names every missing item when refused (not_ready)", async () => {
    actions.setPublicPageAction.mockResolvedValue({
      ok: false,
      kind: "not_ready",
      missing: ["online_fund", "payouts_attested"],
      error: "The give page can't go live yet: ...",
    });
    render(<ConnectPanel slug="s" panel={panelOf("active", { onlineFundCount: 0 })} />);
    click("Turn on the give page");
    const alert = await screen.findByTestId("not-ready");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toMatch(/At least one fund offered online/);
    expect(alert.textContent).toMatch(/Confirmation that Stripe pays out to your bank automatically/);
    expect(alert.textContent).not.toMatch(/finished setup/);
    expect(actions.setPublicPageAction).toHaveBeenCalledWith("s", true);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a successful go-live toasts and refreshes, clearing any earlier missing list", async () => {
    actions.setPublicPageAction.mockResolvedValue({ ok: true, data: { enabled: true, changed: true } });
    render(<ConnectPanel slug="s" panel={panelOf("active", {}, { payoutsAttestedAt: "2026-10-12T12:00:00.000Z" })} />);
    click("Turn on the give page");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("The give page is on."));
    expect(screen.queryByTestId("not-ready")).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it("Take the give page offline asks first, then sends enabled=false", async () => {
    actions.setPublicPageAction.mockResolvedValue({ ok: true, data: { enabled: false, changed: true } });
    render(<ConnectPanel slug="s" panel={panelOf("active", {}, { payoutsAttestedAt: "2026-10-12T12:00:00.000Z", publicEnabledAt: "2026-10-13T12:00:00.000Z" })} />);
    click("Take the give page offline");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/Monthly gifts already set up keep charging in Stripe/);
    expect(actions.setPublicPageAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Take it offline" }));
    await waitFor(() => expect(actions.setPublicPageAction).toHaveBeenCalledWith("s", false));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("The give page is off."));
  });
});

describe("ConnectPanel - payouts attestation", () => {
  it("is an AlertDialog that explains automatic payouts and records on confirm", async () => {
    actions.attestPayoutsAction.mockResolvedValue({ ok: true, data: { changed: true } });
    render(<ConnectPanel slug="s" panel={panelOf("active")} />);
    click("Confirm automatic payouts");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/set to automatic/);
    expect(actions.attestPayoutsAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, payouts are automatic" }));
    await waitFor(() => expect(actions.attestPayoutsAction).toHaveBeenCalledWith("s"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("'Not yet' records nothing", async () => {
    render(<ConnectPanel slug="s" panel={panelOf("active")} />);
    click("Confirm automatic payouts");
    fireEvent.click(await screen.findByRole("button", { name: "Not yet" }));
    expect(actions.attestPayoutsAction).not.toHaveBeenCalled();
  });
});

describe("ConnectPanel - fee rates", () => {
  it("opens the inline editor from the active state only", () => {
    render(<ConnectPanel slug="s" panel={panelOf("active")} />);
    click("Edit fee rates");
    expect(screen.getByLabelText("Card percentage")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close fee rates" })).toBeTruthy();
  });
  it("is not offered while onboarding", () => {
    render(<ConnectPanel slug="s" panel={panelOf("onboarding")} />);
    expect(screen.queryByRole("button", { name: "Edit fee rates" })).toBeNull();
  });
});

describe("ConnectPanel - touch targets and the unconfigured state", () => {
  it("every button is at least 44px tall (min-h-11)", () => {
    render(<ConnectPanel slug="s" panel={panelOf("active")} />);
    for (const b of screen.getAllByRole("button")) expect(b.className).toMatch(/min-h-11/);
  });
  it("renders nothing for an unconfigured installation", () => {
    const { container } = render(<ConnectPanel slug="s" panel={panelOf("unconfigured")} />);
    expect(container.textContent).toBe("");
  });
});
