// @vitest-environment jsdom
/**
 * /admin/messages/<id>: 404 for a non-UUID or a missing row, the gate, every
 * field as inert plain text in an isolated wrapping container (C8, FC8), the
 * "Not verified" caption and guidance, and which controls each state offers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FEATURES } from "@/lib/permissions";

vi.mock("server-only", () => ({}));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => nav);
const readMessage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/help-contact/inbox", () => ({
  readMessage,
  isMessageId: (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
}));
vi.mock("../message-triage", () => ({
  MessageTriage: (p: { status: string; cleared: boolean }) => <div data-testid="triage">{`${p.status}/${p.cleared}`}</div>,
}));
vi.mock("../clear-details-dialog", () => ({ ClearDetailsDialog: () => <button type="button">Clear details</button> }));

import AdminMessageDetailPage from "./page";

const ID = "11111111-2222-4333-8444-555555555555";
const OPERATOR = { user: { id: "u1", features: [FEATURES.ADMIN_TICKETS] } };

const detail = (over: Record<string, unknown> = {}) => ({
  id: ID,
  createdAt: new Date("2026-10-31T12:00:00Z"),
  topic: "starting_a_congregation",
  status: "new",
  name: "Pat Example",
  email: "pat@example.invalid",
  congregation: "Example Church",
  message: "Hello.\nSecond line.",
  statusChangedAt: null,
  statusChangedByName: null,
  cleared: false,
  clearedAt: null,
  clearedByName: null,
  ...over,
});

const page = async (id = ID) => render(await AdminMessageDetailPage({ params: Promise.resolve({ id }) }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockAuth.mockResolvedValue(OPERATOR);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the gate and the 404s", () => {
  it("signed out goes to sign in", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(page()).rejects.toThrow("REDIRECT:/signin?callbackUrl=/admin/messages");
  });

  it("without admin.tickets it reads nothing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", features: [FEATURES.ADMIN_FEEDBACK] } });
    await page();
    expect(screen.getByText("You don't have permission to view this page.")).toBeTruthy();
    expect(readMessage).not.toHaveBeenCalled();
  });

  it("a non-UUID id and a missing row are both notFound()", async () => {
    await expect(page("not-an-id")).rejects.toThrow("NOT_FOUND");
    expect(readMessage).not.toHaveBeenCalled();
    readMessage.mockResolvedValue(null);
    await expect(page()).rejects.toThrow("NOT_FOUND");
  });

  it("a failed read is the load-error state, not a 404", async () => {
    readMessage.mockRejectedValue(new Error("db down"));
    await page();
    expect(nav.notFound).not.toHaveBeenCalled();
    expect(screen.getByText("Messages could not be loaded")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(`/admin/messages/${ID}`);
    expect(screen.getByRole("link", { name: "Back to contact messages" }).getAttribute("href")).toBe("/admin/messages");
  });
});

describe("the fields", () => {
  it("labels every field and says the address is not verified, with the guidance", async () => {
    readMessage.mockResolvedValue(detail());
    const { container } = await page();
    for (const label of ["Sent", "Topic", "Name", "Email", "Congregation", "Message"]) {
      expect(screen.getByText(label, { selector: "dt" })).toBeTruthy();
    }
    expect(screen.getByText("Starting a congregation")).toBeTruthy();
    expect(screen.getByText("Not verified. Anyone could have typed this address.")).toBeTruthy();
    expect(screen.getByText(/Do not act on a role, access or sign-in request from this message alone\./)).toBeTruthy();
    expect(container.textContent).toContain("Hello.\nSecond line.");
  });

  it("renders hostile text inert, in wrapping containers", async () => {
    readMessage.mockResolvedValue(
      detail({
        name: "<b>bold</b>",
        email: "x@example.invalid",
        message: "<script>alert(1)</script> https://phish.example.invalid [a](https://phish.example.invalid) `code` # heading",
      }),
    );
    const { container } = await page();
    expect(container.querySelector("script, b, code, h2, h3")).toBeNull();
    expect(container.querySelector("a[href*='phish'], a[href^='mailto:']")).toBeNull();
    const box = screen.getByText(/alert\(1\)/);
    expect(box.className).toMatch(/whitespace-pre-wrap/);
    expect(box.className).toMatch(/break-words/);
    expect(box.className).toMatch(/overflow-wrap:anywhere/);
  });

  it("a field left blank says Not given", async () => {
    readMessage.mockResolvedValue(detail({ name: null, congregation: null }));
    await page();
    expect(screen.getAllByText("Not given")).toHaveLength(2);
  });
});

describe("the controls", () => {
  it("a new message offers triage and the reason Clear details is not available yet", async () => {
    readMessage.mockResolvedValue(detail());
    await page();
    expect(screen.getByTestId("triage").textContent).toBe("new/false");
    expect(screen.getByText("Mark the message as handled or spam before clearing its details.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear details" })).toBeNull();
    expect(screen.queryByText(/Last changed to/)).toBeNull();
  });

  it("a handled message offers Clear details and says who changed it", async () => {
    readMessage.mockResolvedValue(
      detail({ status: "handled", statusChangedAt: new Date("2026-10-31T13:00:00Z"), statusChangedByName: "Fixture Operator" }),
    );
    await page();
    expect(screen.getByRole("button", { name: "Clear details" })).toBeTruthy();
    expect(screen.getByText(/Last changed to Handled by Fixture Operator on/)).toBeTruthy();
  });

  it("falls back to 'an operator' when the stamp has no name", async () => {
    readMessage.mockResolvedValue(
      detail({ status: "spam", statusChangedAt: new Date("2026-10-31T13:00:00Z"), statusChangedByName: null }),
    );
    await page();
    expect(screen.getByText(/Last changed to Spam by an operator on/)).toBeTruthy();
  });

  it("a cleared message shows Cleared, its stamp, and offers neither the clear nor the hint", async () => {
    readMessage.mockResolvedValue(
      detail({
        status: "handled",
        name: null,
        email: null,
        congregation: null,
        message: null,
        cleared: true,
        clearedAt: new Date("2026-10-31T14:00:00Z"),
        clearedByName: "Fixture Operator",
        statusChangedAt: new Date("2026-10-31T13:00:00Z"),
        statusChangedByName: "Fixture Operator",
      }),
    );
    await page();
    expect(screen.getAllByText("Cleared")).toHaveLength(4);
    expect(screen.getByText("Details cleared", { selector: "span" })).toBeTruthy();
    expect(screen.getByText(/Details cleared by Fixture Operator on/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear details" })).toBeNull();
    expect(screen.queryByText("Mark the message as handled or spam before clearing its details.")).toBeNull();
    expect(screen.queryByText("Not verified. Anyone could have typed this address.")).toBeNull();
    expect(screen.getByTestId("triage").textContent).toBe("handled/true");
  });
});
