// @vitest-environment jsdom
/**
 * The overview's "needs attention" list (docs/work-log/2026-10-15-online-giving.md,
 * S5). It renders ONLY fields of `Attention`, in words, with where to act - so
 * these tests are the parity check between what `loadAttention()` returns and
 * what a treasurer is told. Color is never the signal: every row has text.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Attention } from "@/lib/giving/attention-pure";
import { AttentionList, attentionRows } from "./attention-list";

const CLEAR: Attention = {
  scope: "full",
  failedGifts: 0, stuckPending: 0, monthlyPaymentFailures: 0,
  connection: { state: "active", testMode: false, requirementsDue: false, publicPageOn: true },
  parkedEvents: 0, deadLetters: 0, staleStatements: 0, possibleDuplicateDonors: 0, linkProposals: 0,
};

afterEach(cleanup);

describe("attentionRows", () => {
  it("is empty for a clear organization", () => {
    expect(attentionRows(CLEAR, "alder-creek")).toEqual([]);
  });

  it("has one row per non-zero count, singular and plural, each with its own words", () => {
    const rows = attentionRows(
      { ...CLEAR, failedGifts: 1, stuckPending: 3, monthlyPaymentFailures: 1, deadLetters: 2, parkedEvents: 1, staleStatements: 4, possibleDuplicateDonors: 2, linkProposals: 1 },
      "alder-creek",
    );
    expect(Object.fromEntries(rows.map((r) => [r.key, r.text]))).toEqual({
      failed: "1 gift has failed in the last 90 days.",
      pending: "3 bank gifts have been pending for more than a week.",
      monthly: expect.stringMatching(/^1 monthly gift's latest payment failed\./),
      dead: "2 payment notices from Stripe could not be processed. Contact support.",
      parked: "1 payment notice is waiting for related information and will be retried.",
      stale: "4 statements are out of date because a gift changed after it was issued.",
      dupes: "2 pairs of donors look like the same giver.",
      links: "1 donor looks like a member (same email on file).",
    });
  });

  it("links the actionable rows to the filtered list or page that resolves them", () => {
    const rows = attentionRows({ ...CLEAR, failedGifts: 2, stuckPending: 1, possibleDuplicateDonors: 1, linkProposals: 1 }, "alder-creek");
    const hrefs = Object.fromEntries(rows.map((r) => [r.key, r.href]));
    expect(hrefs).toEqual({
      failed: "/o/alder-creek/admin/giving/gifts?status=failed",
      pending: "/o/alder-creek/admin/giving/gifts?status=pending",
      dupes: "/o/alder-creek/admin/giving/donors",
      links: "/o/alder-creek/admin/giving/donors",
    });
  });

  it("a restricted Stripe account, or one with requirements due, is a row; a disconnected one with requirements is not", () => {
    expect(attentionRows({ ...CLEAR, connection: { state: "restricted", testMode: false, requirementsDue: false, publicPageOn: false } }, "s")[0]!.key).toBe("restricted");
    expect(attentionRows({ ...CLEAR, connection: { state: "active", testMode: false, requirementsDue: true, publicPageOn: true } }, "s")[0]!.key).toBe("requirements");
    expect(attentionRows({ ...CLEAR, connection: { state: "disconnected", testMode: false, requirementsDue: true, publicPageOn: false } }, "s")).toEqual([]);
  });

  it("treats null (a recorder's hidden fields) as zero, so a recorder sees at most the suggestions line", () => {
    const recorder: Attention = {
      scope: "recorder", failedGifts: null, stuckPending: null, monthlyPaymentFailures: null, connection: null,
      parkedEvents: null, deadLetters: null, staleStatements: null, possibleDuplicateDonors: null, linkProposals: 3,
    };
    expect(attentionRows(recorder, "s").map((r) => r.key)).toEqual(["links"]);
    expect(attentionRows({ ...recorder, linkProposals: 0 }, "s")).toEqual([]);
  });
});

describe("AttentionList", () => {
  it("clear: a designed empty state, not a blank", () => {
    render(<AttentionList attention={CLEAR} slug="alder-creek" />);
    expect(screen.getByText("Nothing needs attention")).toBeTruthy();
    expect(screen.queryByTestId("attention-list")).toBeNull();
  });

  it("populated: a list item per row, with an action link ≥ 44px tall for the actionable ones", () => {
    render(<AttentionList attention={{ ...CLEAR, failedGifts: 2 }} slug="alder-creek" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    const link = screen.getByRole("link", { name: "Review failed gifts" });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/admin/giving/gifts?status=failed");
    expect(link.className).toContain("min-h-11");
  });

  it("a row without an action (a failed renewal) shows its words and no link", () => {
    render(<AttentionList attention={{ ...CLEAR, monthlyPaymentFailures: 2 }} slug="s" />);
    expect(screen.getByText(/2 monthly gifts' latest payment failed/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
