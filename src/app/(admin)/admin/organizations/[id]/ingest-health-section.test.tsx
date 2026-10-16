// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IngestHealthSection } from "./ingest-health-section";

afterEach(cleanup);

const row = (over: Record<string, unknown> = {}) => ({
  organizationId: "org-1",
  connectionId: "c1",
  provider: "stripe",
  livemode: false,
  status: "active",
  receivedCount: 12,
  appliedCount: 9,
  parkedCount: 2,
  deadLetterCount: 1,
  lastReceivedAt: "2026-10-15T12:00:00.000Z",
  oldestPendingSeconds: 3 * 3600 + 20 * 60,
  ...over,
}) as never;

describe("IngestHealthSection", () => {
  it("shows this organization's counts and links to the platform page", () => {
    render(<IngestHealthSection rows={[row()]} />);
    const card = screen.getByTestId("ingest-health-connection");
    expect(card.textContent).toMatch(/Received\s*12/);
    expect(card.textContent).toMatch(/Applied\s*9/);
    expect(card.textContent).toMatch(/Waiting\s*2/);
    expect(card.textContent).toMatch(/Dead letters\s*1/);
    expect(card.textContent).toMatch(/Test/);
    expect(card.textContent).toMatch(/3 h 20 min/);
    expect(screen.getByRole("link", { name: "Open giving health" }).getAttribute("href")).toBe("/admin/giving");
  });

  it("says in words how many events were given up on", () => {
    render(<IngestHealthSection rows={[row(), row({ connectionId: "c2", deadLetterCount: 2 })]} />);
    expect(screen.getByTestId("ingest-health-section").textContent).toMatch(/3 events have been given up on/);
  });

  it("empty: explains there is no connection yet (not a blank)", () => {
    render(<IngestHealthSection rows={[]} />);
    expect(screen.getByText(/no Stripe connection yet/)).toBeTruthy();
    expect(screen.queryByTestId("ingest-health-connection")).toBeNull();
  });

  it("error (null rows): says it can't load - never an all-clear", () => {
    render(<IngestHealthSection rows={null} />);
    expect(screen.getByText(/can.t load this organization.s payment-notice health/)).toBeTruthy();
    expect(screen.queryByText(/given up on/)).toBeNull();
  });

  it("shows no donor, amount or account id", () => {
    const { container } = render(<IngestHealthSection rows={[row()]} />);
    expect(container.textContent).not.toMatch(/\$\d|acct_|evt_/);
  });
});
