// @vitest-environment jsdom
/**
 * The six connection states (docs/work-log/2026-10-15-online-giving.md, Batch
 * 3b): what the card says and which primary action the panel offers, per state.
 * The server card and the client panel render together here with the actions
 * mocked; interactions live in connect-panel.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("./connect/actions", () => ({
  startConnectAction: vi.fn(),
  continueConnectAction: vi.fn(),
  refreshConnectionAction: vi.fn(),
  attestPayoutsAction: vi.fn(),
  setPublicPageAction: vi.fn(),
  disconnectAction: vi.fn(),
  updateRatesAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ConnectionCard } from "./connection-card";
import { panelOf } from "./connect-fixtures";

afterEach(cleanup);

const button = (name: RegExp | string) => screen.queryByRole("button", { name });

describe("ConnectionCard - the six states", () => {
  it("not started: Connect Stripe is the only primary action, with the G15 disclosure", () => {
    render(<ConnectionCard slug="alder-creek" panel={panelOf("none")} />);
    expect(screen.getByTestId("connection-card").getAttribute("data-state")).toBe("not_started");
    expect(screen.getByTestId("connection-state").textContent).toBe("Not connected");
    expect(button("Connect Stripe")).toBeTruthy();
    expect(button("Refresh status")).toBeNull();
    expect(button("Disconnect")).toBeNull();
    const disclosure = screen.getByTestId("connect-disclosure").textContent ?? "";
    expect(disclosure).toMatch(/processing fee/);
    expect(disclosure).toMatch(/does not give tax advice/);
  });

  it("details due: Continue setup is primary, Refresh and Disconnect are secondary, facts show what Stripe has", () => {
    render(<ConnectionCard slug="alder-creek" panel={panelOf("onboarding")} />);
    expect(screen.getByTestId("connection-card").getAttribute("data-state")).toBe("details_due");
    expect(screen.getByTestId("connection-state").textContent).toBe("Setup needs details");
    expect(button("Continue setup")).toBeTruthy();
    expect(button("Refresh status")).toBeTruthy();
    expect(button("Disconnect")).toBeTruthy();
    const facts = within(screen.getByTestId("connection-facts"));
    expect(facts.getByText("Details sent to Stripe").closest("li")?.textContent).toMatch(/Needed/);
    expect(screen.getByTestId("connection-mode").textContent).toBe("Test mode");
  });

  it("pending verification: Refresh status is primary and Continue is demoted to 'Review details on Stripe'", () => {
    render(
      <ConnectionCard slug="alder-creek" panel={panelOf("onboarding", {}, { detailsSubmitted: true, requirementsDue: false })} />,
    );
    expect(screen.getByTestId("connection-card").getAttribute("data-state")).toBe("pending_verification");
    expect(screen.getByTestId("connection-state").textContent).toBe("Waiting for Stripe");
    expect(button("Refresh status")).toBeTruthy();
    expect(button("Review details on Stripe")).toBeTruthy();
    expect(button("Continue setup")).toBeNull();
    // exactly one refresh button (not duplicated as primary + secondary)
    expect(screen.getAllByRole("button", { name: "Refresh status" })).toHaveLength(1);
  });

  it("active, not yet attested or public: names the three go-live items, offers attest and go-live, rates and disconnect", () => {
    render(<ConnectionCard slug="alder-creek" panel={panelOf("active", { onlineFundCount: 0 })} />);
    expect(screen.getByTestId("connection-state").textContent).toBe("Connected");
    const list = within(screen.getByTestId("go-live-checklist"));
    expect(list.getByText("A Stripe account that has finished setup").closest("li")?.textContent).toMatch(/Done/);
    expect(list.getByText("At least one fund offered online").closest("li")?.textContent).toMatch(/Needed/);
    expect(list.getByText(/pays out to your bank automatically/).closest("li")?.textContent).toMatch(/Needed/);
    expect(screen.getByRole("link", { name: "Offer a fund online" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/funds");
    expect(button("Confirm automatic payouts")).toBeTruthy();
    expect(button("Turn on the give page")).toBeTruthy();
    expect(button("Edit fee rates")).toBeTruthy();
    expect(button("Disconnect")).toBeTruthy();
    expect(screen.getByTestId("rates-summary").textContent).toBe("Card: 2.9% + $0.30. Bank: 0.8%, capped at $5.00.");
    expect(screen.getByTestId("give-page-state").textContent).toMatch(/give page is off/);
  });

  it("active, attested and public: offers Take the give page offline, not attest or go-live, and says since when", () => {
    render(
      <ConnectionCard
        slug="alder-creek"
        panel={panelOf("active", {}, { payoutsAttestedAt: "2026-10-12T12:00:00.000Z", publicEnabledAt: "2026-10-13T12:00:00.000Z", livemode: true })}
      />,
    );
    expect(screen.getByTestId("give-page-state").textContent).toMatch(/give page is on/);
    expect(button("Take the give page offline")).toBeTruthy();
    expect(button("Confirm automatic payouts")).toBeNull();
    expect(button("Turn on the give page")).toBeNull();
    expect(screen.queryByTestId("go-live-checklist")).toBeNull();
    expect(screen.getByTestId("connection-mode").textContent).toBe("Live");
  });

  it("restricted: says Stripe needs attention with its reason code, Continue is primary", () => {
    render(<ConnectionCard slug="alder-creek" panel={panelOf("restricted")} />);
    expect(screen.getByTestId("connection-state").textContent).toBe("Needs attention");
    expect(screen.getByTestId("restricted-detail").textContent).toMatch(/waiting on more information/);
    expect(screen.getByTestId("restricted-detail").textContent).toMatch(/requirements\.past_due/);
    expect(button("Continue setup")).toBeTruthy();
    expect(button("Refresh status")).toBeTruthy();
  });

  it("disconnected: says why and when, offers only a NEW connection, and shows no open-connection controls", () => {
    render(<ConnectionCard slug="alder-creek" panel={panelOf("disconnected")} />);
    expect(screen.getByTestId("connection-state").textContent).toBe("Disconnected");
    expect(screen.getByTestId("disconnected-detail").textContent).toMatch(/Disconnected from PresbyPortal by your treasurer/);
    expect(button("Connect a new Stripe account")).toBeTruthy();
    expect(button("Refresh status")).toBeNull();
    expect(button("Disconnect")).toBeNull();
    expect(screen.queryByTestId("connection-facts")).toBeNull();
    expect(screen.queryByTestId("connection-mode")).toBeNull();
  });

  it("disconnected from Stripe's side reads differently from a treasurer disconnect", () => {
    render(<ConnectionCard slug="alder-creek" panel={panelOf("disconnected", {}, { disconnectedReason: "deauthorized" })} />);
    expect(screen.getByTestId("disconnected-detail").textContent).toMatch(/from the Stripe side/);
  });

  it("unconfigured installation: a state, not a stack trace - no buttons at all", () => {
    render(<ConnectionCard slug="alder-creek" panel={panelOf("unconfigured")} />);
    expect(screen.getByTestId("connection-state").textContent).toBe("Not available");
    expect(screen.getByText(/Online giving isn.t enabled on this installation/)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("never prints a Stripe account id", () => {
    const { container } = render(<ConnectionCard slug="alder-creek" panel={panelOf("active")} />);
    expect(container.textContent).not.toMatch(/acct_/);
  });
});
