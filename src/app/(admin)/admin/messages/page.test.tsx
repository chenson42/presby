// @vitest-environment jsdom
/**
 * /admin/messages (the list): the gate, the filter and cursor validation, the
 * four states (cards, empty per filter, load error, no permission), and the
 * XSS invariant: a stranger's text renders as inert text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { FEATURES } from "@/lib/permissions";

vi.mock("server-only", () => ({}));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
const listMessages = vi.hoisted(() => vi.fn());
vi.mock("@/lib/help-contact/inbox", () => ({
  listMessages,
  parseCursor: (v: unknown) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v) ? v : null,
}));

import AdminMessagesPage from "./page";

const OPERATOR = { user: { id: "u1", features: [FEATURES.ADMIN_TICKETS] } };
const CURSOR = "2026-10-31T12:00:00.000123Z";

const row = (over: Record<string, unknown> = {}) => ({
  id: "11111111-2222-4333-8444-555555555555",
  createdAt: new Date("2026-10-31T12:00:00Z"),
  topic: "signing_in",
  status: "new",
  name: "Pat Example",
  excerpt: "I lost my phone.",
  cleared: false,
  cursor: CURSOR,
  ...over,
});

const render_ = async (sp: Record<string, string> = {}) =>
  render(await AdminMessagesPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the gate", () => {
  it("sends a signed-out visitor to sign in", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(render_()).rejects.toThrow("REDIRECT:/signin?callbackUrl=/admin/messages");
    expect(listMessages).not.toHaveBeenCalled();
  });

  it("shows the denial and reads nothing without admin.tickets", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", features: [FEATURES.ADMIN_FEEDBACK, FEATURES.ADMIN_DASHBOARD] } });
    await render_();
    expect(screen.getByText("You don't have permission to view this page.")).toBeTruthy();
    expect(listMessages).not.toHaveBeenCalled();
  });
});

describe("filters and cursor", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(OPERATOR);
    listMessages.mockResolvedValue({ rows: [], hasMore: false });
  });

  it("defaults to New and marks it current", async () => {
    await render_();
    expect(listMessages).toHaveBeenCalledWith({ status: "new", before: null });
    const nav = screen.getByRole("navigation", { name: "Show messages by status" });
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("aria-current")])).toEqual([
      ["New", "page"],
      ["Handled", null],
      ["Spam", null],
      ["All", null],
    ]);
  });

  it("an unknown status falls back to New and a malformed cursor is ignored", async () => {
    await render_({ status: "'; drop table x;--", before: "yesterday" });
    expect(listMessages).toHaveBeenCalledWith({ status: "new", before: null });
  });

  it("passes a valid status and cursor through", async () => {
    await render_({ status: "spam", before: CURSOR });
    expect(listMessages).toHaveBeenCalledWith({ status: "spam", before: CURSOR });
  });

  it("each filter has its own empty sentence", async () => {
    for (const [status, text] of [
      ["new", "No new messages."],
      ["handled", "No handled messages."],
      ["spam", "No messages marked as spam."],
      ["all", "No messages yet. Messages from the contact form appear here."],
    ] as const) {
      await render_({ status });
      expect(screen.getByText(text)).toBeTruthy();
      cleanup();
    }
  });
});

describe("the cards", () => {
  beforeEach(() => mockAuth.mockResolvedValue(OPERATOR));

  it("renders a card per message with the topic, status, name, excerpt and a Read message link", async () => {
    listMessages.mockResolvedValue({ rows: [row(), row({ id: "22222222-2222-4333-8444-555555555555", name: null, status: "handled" })], hasMore: false });
    await render_();
    expect(screen.getByText("2 messages shown, newest first.")).toBeTruthy();
    expect(screen.getAllByText("I can't sign in or I lost my codes")).toHaveLength(2);
    expect(screen.getByText("Pat Example")).toBeTruthy();
    expect(screen.getByText("No name given")).toBeTruthy();
    expect(within(screen.getByRole("list")).getByText("Handled")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Read message" }).map((a) => a.getAttribute("href"))).toEqual([
      "/admin/messages/11111111-2222-4333-8444-555555555555",
      "/admin/messages/22222222-2222-4333-8444-555555555555",
    ]);
  });

  it("uses the singular count line for one message", async () => {
    listMessages.mockResolvedValue({ rows: [row()], hasMore: false });
    await render_();
    expect(screen.getByText("1 message shown, newest first.")).toBeTruthy();
  });

  it("a cleared message shows its badge and no excerpt", async () => {
    listMessages.mockResolvedValue({ rows: [row({ cleared: true, excerpt: null, name: null, status: "spam" })], hasMore: false });
    await render_({ status: "all" });
    expect(screen.getByText("Details cleared")).toBeTruthy();
    expect(within(screen.getByRole("list")).getByText("Spam")).toBeTruthy();
  });

  it("offers Older messages, keyed on the last row's cursor and the current filter, only when there are more", async () => {
    listMessages.mockResolvedValue({ rows: [row()], hasMore: true });
    await render_({ status: "handled" });
    const older = screen.getByRole("link", { name: "Older messages" });
    expect(older.getAttribute("href")).toBe(`/admin/messages?status=handled&before=${encodeURIComponent(CURSOR)}`);
    cleanup();
    listMessages.mockResolvedValue({ rows: [row()], hasMore: false });
    await render_();
    expect(screen.queryByRole("link", { name: "Older messages" })).toBeNull();
  });

  it("renders a stranger's text as inert text: no element, no anchor, no markdown", async () => {
    listMessages.mockResolvedValue({
      rows: [
        row({
          name: "<img src=x onerror=alert(1)>",
          excerpt: "<script>alert(1)</script> https://phish.example.invalid/login [click](https://phish.example.invalid) **bold**",
        }),
      ],
      hasMore: false,
    });
    const { container } = await render_();
    expect(container.querySelector("script, img")).toBeNull();
    expect(container.querySelector("a[href*='phish']")).toBeNull();
    expect(container.querySelector("strong, em")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(container.textContent).toContain("[click](https://phish.example.invalid) **bold**");
  });
});

describe("a failed read", () => {
  it("is the load-error state with a retry, never an empty list", async () => {
    mockAuth.mockResolvedValue(OPERATOR);
    listMessages.mockRejectedValue(new Error("db down"));
    await render_({ status: "handled" });
    expect(screen.getByText("Messages could not be loaded")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/admin/messages?status=handled");
    expect(screen.queryByText("No handled messages.")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Contact messages" })).toBeTruthy();
  });
});
