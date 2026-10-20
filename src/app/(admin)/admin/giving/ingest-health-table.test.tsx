// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { IngestHealthTable } from "./ingest-health-table";

afterEach(cleanup);

const row = (over: Record<string, unknown> = {}) => ({
  organizationId: "org-1",
  connectionId: "c1",
  provider: "stripe",
  livemode: true,
  status: "active",
  receivedCount: 40,
  appliedCount: 38,
  parkedCount: 1,
  deadLetterCount: 0,
  lastReceivedAt: "2026-10-15T12:00:00.000Z",
  oldestPendingSeconds: 90,
  ...over,
}) as never;

const names = new Map([["org-1", "Alder Creek Presbyterian Church"], ["org-2", "Fernwood Community Church"]]);

describe("IngestHealthTable", () => {
  it("a real table: one row per connection with the organization name linked to its page", () => {
    render(<IngestHealthTable rows={[row(), row({ organizationId: "org-2", connectionId: "c2", livemode: false })]} names={names} />);
    expect(screen.getByRole("table")).toBeTruthy();
    const rows = screen.getAllByTestId("ingest-health-row");
    expect(rows).toHaveLength(2);
    const link = within(rows[0]!).getByRole("link", { name: "Alder Creek Presbyterian Church" });
    expect(link.getAttribute("href")).toBe("/admin/organizations/org-1");
    expect(within(rows[0]!).getByText("Live")).toBeTruthy();
    expect(within(rows[1]!).getByText("Test")).toBeTruthy();
  });

  it("shows counts and ages as words and numbers", () => {
    render(<IngestHealthTable rows={[row({ oldestPendingSeconds: 7200 })]} names={names} />);
    const r = screen.getByTestId("ingest-health-row");
    expect(r.textContent).toMatch(/40/);
    expect(r.textContent).toMatch(/38/);
    expect(r.textContent).toMatch(/2 h/);
  });

  it("a connection that has never received anything says Never; nothing waiting is a dash", () => {
    render(<IngestHealthTable rows={[row({ lastReceivedAt: null, oldestPendingSeconds: null })]} names={names} />);
    const r = screen.getByTestId("ingest-health-row");
    expect(r.textContent).toMatch(/Never/);
    expect(r.textContent).toMatch(/–/);
  });

  it("a non-zero dead-letter count is bold text, not colour alone", () => {
    render(<IngestHealthTable rows={[row({ deadLetterCount: 3 })]} names={names} />);
    const cell = screen.getByTestId("dead-letter-count");
    expect(cell.textContent).toBe("3");
    expect(cell.className).toMatch(/font-semibold/);
  });

  it("an organization with no public name falls back, never a blank or an id", () => {
    render(<IngestHealthTable rows={[row({ organizationId: "org-9" })]} names={names} />);
    expect(screen.getByText("Unknown organization")).toBeTruthy();
  });

  it("empty: a designed empty state, not a blank table", () => {
    render(<IngestHealthTable rows={[]} names={names} />);
    expect(screen.getByTestId("ingest-health-empty").textContent).toMatch(/No Stripe connections yet/);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("carries no donor, amount or account id", () => {
    const { container } = render(<IngestHealthTable rows={[row()]} names={names} />);
    expect(container.textContent).not.toMatch(/\$\d|acct_/);
  });
});
