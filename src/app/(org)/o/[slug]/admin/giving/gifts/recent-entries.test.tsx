// @vitest-environment jsdom
/**
 * "Your recent entries" (S4): the recorder's own last 30 days. A designed empty
 * state, the amount and method in words, a void control only on a live entry.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./void-dialog", () => ({ VoidGiftDialog: ({ giftId }: { giftId: string }) => <button type="button">Void {giftId}</button> }));

import { RecentEntries } from "./recent-entries";

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id, occurredOn: "2026-04-12", donorName: "Imogen Thackeray", fundName: "General Fund", method: "check", amountCents: 12_550,
  voided: false, createdAt: "2026-04-12T15:00:00Z", canVoid: true, ...over,
}) as never;

afterEach(cleanup);

describe("RecentEntries", () => {
  it("empty: says what fills it, and offers the action only to someone who can record", () => {
    render(<RecentEntries slug="alder-creek" entries={[]} canRecord />);
    expect(screen.getByText(/haven.t recorded any gifts in the last 30 days/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Record a gift" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/gifts/new");
    cleanup();
    render(<RecentEntries slug="alder-creek" entries={[]} canRecord={false} />);
    expect(screen.queryByRole("link", { name: "Record a gift" })).toBeNull();
  });

  it("lists donor, amount, date, fund and method", () => {
    render(<RecentEntries slug="s" entries={[entry("e1")]} canRecord />);
    expect(screen.getByText("Imogen Thackeray")).toBeTruthy();
    expect(screen.getByText("$125.50")).toBeTruthy();
    expect(screen.getByText(/General Fund · Check/)).toBeTruthy();
  });

  it("a live entry has a void control; a voided one says Voided and has none", () => {
    render(<RecentEntries slug="s" entries={[entry("e1"), entry("e2", { voided: true, canVoid: false })]} canRecord />);
    expect(screen.getByRole("button", { name: "Void e1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Void e2" })).toBeNull();
    expect(screen.getByText("Voided")).toBeTruthy();
  });

  it("shows no contact detail, donor id or total (S4)", () => {
    const { container } = render(<RecentEntries slug="s" entries={[entry("e1")]} canRecord />);
    expect(container.textContent).not.toMatch(/@|total/i);
    expect(container.querySelector("a[href*='donors']")).toBeNull();
  });
});
