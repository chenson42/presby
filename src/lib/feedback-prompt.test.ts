// vi.mock() calls are hoisted before imports by Vitest's transform.
// All mocks must be declared before any import statements.
vi.mock("server-only", () => ({}));

/**
 * Tests for `shouldShowFeedbackPrompt`/`getFeedbackPromptState` — extracted
 * to `src/lib/feedback-prompt.ts` from `(member)/home/page.tsx`'s prior
 * inline copy, commit 2 of docs/work-log/2026-08-27-product-ia-scaffold.md
 * (Phase 3 §6b/§9, DECISION-117). Net-new coverage, not a port — confirmed
 * no `(member)/home/page.test.tsx` existed before this extraction.
 *
 * `shouldShowFeedbackPrompt`'s four branches: no row (new user, show),
 * opted out (never show), snoozed today (don't show), submitted today
 * (don't show), and the "else" true case.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mockFindFirst = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      feedbackPromptState: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
}));

import { getFeedbackPromptState, shouldShowFeedbackPrompt } from "./feedback-prompt";

afterEach(() => {
  mockFindFirst.mockReset();
});

describe("shouldShowFeedbackPrompt", () => {
  it("shows the prompt for a new user with no row at all", () => {
    expect(shouldShowFeedbackPrompt(null)).toBe(true);
  });

  it("never shows the prompt once the user has opted out", () => {
    expect(
      shouldShowFeedbackPrompt({
        optedOut: true,
        lastSnoozedDate: null,
        lastSubmittedDate: null,
      }),
    ).toBe(false);
  });

  it("hides the prompt when snoozed today (UTC)", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(
      shouldShowFeedbackPrompt({
        optedOut: false,
        lastSnoozedDate: today,
        lastSubmittedDate: null,
      }),
    ).toBe(false);
  });

  it("hides the prompt when submitted today (UTC)", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(
      shouldShowFeedbackPrompt({
        optedOut: false,
        lastSnoozedDate: null,
        lastSubmittedDate: today,
      }),
    ).toBe(false);
  });

  it("shows the prompt when a past snooze/submission date has aged out", () => {
    expect(
      shouldShowFeedbackPrompt({
        optedOut: false,
        lastSnoozedDate: "2020-01-01",
        lastSubmittedDate: "2020-01-01",
      }),
    ).toBe(true);
  });
});

describe("getFeedbackPromptState", () => {
  it("reads the row keyed by the given userId, selecting only the three suppression columns", async () => {
    mockFindFirst.mockResolvedValue({
      optedOut: false,
      lastSnoozedDate: null,
      lastSubmittedDate: null,
    });

    const result = await getFeedbackPromptState("user-1");

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: {
          optedOut: true,
          lastSnoozedDate: true,
          lastSubmittedDate: true,
        },
      }),
    );
    expect(result).toEqual({
      optedOut: false,
      lastSnoozedDate: null,
      lastSubmittedDate: null,
    });
  });

  it("returns null (not undefined) when no row exists", async () => {
    mockFindFirst.mockResolvedValue(undefined);

    const result = await getFeedbackPromptState("user-1");

    expect(result).toBeNull();
  });
});
