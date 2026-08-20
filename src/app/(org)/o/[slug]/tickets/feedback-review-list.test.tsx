// @vitest-environment jsdom
/**
 * Tests for <FeedbackReviewList>. `./actions` is mocked — it is a "use
 * server" module pulled in transitively by <DismissFeedbackDialog>, same
 * reasoning `admin/roles/page.test.tsx`'s header gives for its own mock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FeedbackReviewList } from "./feedback-review-list";
import type { FeedbackListEntry } from "@/lib/tickets";

vi.mock("./actions", () => ({
  dismissFeedbackAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

const FEEDBACK: FeedbackListEntry = {
  feedbackId: "feedback-1",
  submitterDisplayName: "Priya Balakrishnan",
  body: "It would help if the events calendar showed which Sunday school class meets when.",
  createdAt: "2026-08-17T09:05:00Z",
};

describe("FeedbackReviewList — empty state", () => {
  it("renders real copy, not a blank screen, when there is no pending feedback", () => {
    render(<FeedbackReviewList feedback={[]} slug="alder-creek" />);
    expect(screen.getByText(/no incoming feedback right now/i)).toBeTruthy();
  });
});

describe("FeedbackReviewList — populated", () => {
  it("renders the submitter, body, and a Promote link to /tickets/new?fromFeedback=<id>", () => {
    render(<FeedbackReviewList feedback={[FEEDBACK]} slug="alder-creek" />);
    expect(screen.getByText("Priya Balakrishnan")).toBeTruthy();
    expect(screen.getByText(/sunday school class/i)).toBeTruthy();
    const promoteLink = screen.getByRole("link", { name: /promote to ticket/i });
    expect(promoteLink.getAttribute("href")).toBe(
      "/o/alder-creek/tickets/new?fromFeedback=feedback-1",
    );
  });

  it("renders a Dismiss trigger for each row", () => {
    render(<FeedbackReviewList feedback={[FEEDBACK]} slug="alder-creek" />);
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeTruthy();
  });
});
