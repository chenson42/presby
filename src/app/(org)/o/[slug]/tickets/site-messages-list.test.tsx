// @vitest-environment jsdom
/**
 * Tests for <SiteMessagesList> — ContactForm's read side (DECISION-089).
 * `./actions` is mocked, same reasoning `feedback-review-list.test.tsx`'s
 * own header gives for its own mock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SiteMessagesList } from "./site-messages-list";
import type { SiteContactMessageEntry } from "@/lib/sites";

const markSiteContactMessageReadAction = vi.fn();
vi.mock("./actions", () => ({
  markSiteContactMessageReadAction: (...args: unknown[]) =>
    markSiteContactMessageReadAction(...args),
}));

afterEach(() => {
  cleanup();
  markSiteContactMessageReadAction.mockReset();
});

const NEW_MESSAGE: SiteContactMessageEntry = {
  messageId: "msg-1",
  name: "Nadia Okonkwo",
  email: "nadia@example.invalid",
  body: "Is there a Wednesday evening service?",
  status: "new",
  createdAt: "2026-08-18T09:05:00Z",
};

const READ_MESSAGE: SiteContactMessageEntry = {
  ...NEW_MESSAGE,
  messageId: "msg-2",
  status: "read",
};

describe("SiteMessagesList — empty state", () => {
  it("renders real copy, not a blank screen, when there are no messages", () => {
    render(<SiteMessagesList messages={[]} slug="alder-creek" />);
    expect(screen.getByText(/no site messages yet/i)).toBeTruthy();
  });
});

describe("SiteMessagesList — populated", () => {
  it("renders the visitor name, email, body, and a New badge for an unread message", () => {
    render(<SiteMessagesList messages={[NEW_MESSAGE]} slug="alder-creek" />);
    expect(screen.getByText("Nadia Okonkwo")).toBeTruthy();
    expect(screen.getByText("nadia@example.invalid")).toBeTruthy();
    expect(screen.getByText(/wednesday evening service/i)).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByRole("button", { name: /mark read/i })).toBeTruthy();
  });

  it("does not render a New badge or a Mark read control for an already-read message", () => {
    render(<SiteMessagesList messages={[READ_MESSAGE]} slug="alder-creek" />);
    expect(screen.queryByText("New")).toBeNull();
    expect(screen.queryByRole("button", { name: /mark read/i })).toBeNull();
  });

  it("optimistically clears the New badge on Mark read success", async () => {
    markSiteContactMessageReadAction.mockResolvedValue({ ok: true });

    render(<SiteMessagesList messages={[NEW_MESSAGE]} slug="alder-creek" />);
    fireEvent.click(screen.getByRole("button", { name: /mark read/i }));

    await waitFor(() => {
      expect(markSiteContactMessageReadAction).toHaveBeenCalledWith(
        "alder-creek",
        "msg-1",
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("New")).toBeNull();
    });
  });

  it("reverts the New badge on Mark read failure", async () => {
    markSiteContactMessageReadAction.mockResolvedValue({
      ok: false,
      error: "That message no longer exists.",
    });

    render(<SiteMessagesList messages={[NEW_MESSAGE]} slug="alder-creek" />);
    fireEvent.click(screen.getByRole("button", { name: /mark read/i }));

    await waitFor(() => {
      expect(markSiteContactMessageReadAction).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText("New")).toBeTruthy();
    });
  });
});
