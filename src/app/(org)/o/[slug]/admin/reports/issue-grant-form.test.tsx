// @vitest-environment jsdom
/**
 * Tests for <IssueGrantForm> — increment 6 (D16/DECISION-147),
 * `docs/work-log/2026-09-25-submission-grants.md` Phase 4 batch C.
 *
 * `./actions` is mocked — same reasoning every sibling form test in this
 * directory gives (`grant-role-form.test.tsx` et al.): the real module pulls
 * `@/lib/statistics-grants` (and the Neon pool) into the module graph.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockIssueStatisticsGrantAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  issueStatisticsGrantAction: (...args: unknown[]) =>
    mockIssueStatisticsGrantAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const mockRouterRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

import { IssueGrantForm } from "./issue-grant-form";

afterEach(() => {
  cleanup();
  mockIssueStatisticsGrantAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

const CONGREGATIONS = [
  { organizationId: "cong-1", name: "Quillhaven Presbyterian Church" },
  { organizationId: "cong-2", name: "Marrowbone Presbyterian Church" },
];

describe("IssueGrantForm — empty state", () => {
  it("renders a helpful message when there are no issuable congregations", () => {
    render(<IssueGrantForm slug="northern-reach" congregations={[]} />);
    expect(
      screen.getByText(/no unmanaged or invited member congregations/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /issue grant/i })).toBeNull();
  });
});

describe("IssueGrantForm — congregation picker", () => {
  it("renders exactly the congregations it was given, first pre-selected", () => {
    render(<IssueGrantForm slug="northern-reach" congregations={CONGREGATIONS} />);
    const select = screen.getByLabelText(/^congregation/i) as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    expect(select.value).toBe("cong-1");
  });
});

describe("IssueGrantForm — client-side validation", () => {
  it("refuses to submit with a blank recipient name", async () => {
    render(<IssueGrantForm slug="northern-reach" congregations={CONGREGATIONS} />);
    fireEvent.change(screen.getByLabelText(/^recipient email/i), {
      target: { value: "clerk@quillhaven.example.invalid" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /issue grant/i }));
    });
    expect(toastError).toHaveBeenCalledWith("Enter the recipient's name.");
    expect(mockIssueStatisticsGrantAction).not.toHaveBeenCalled();
  });

  it("refuses an email with no @ — blocked by the native type=\"email\" constraint before any JS runs", async () => {
    // `<Input type="email">` (the codebase-wide convention — signin,
    // forgot-password, member forms all use it) makes the browser's OWN
    // constraint validation refuse the submit event for a malformed value
    // before this component's onSubmit ever runs — proven here by asserting
    // NEITHER the toast nor the action fires, rather than asserting a toast
    // this input type structurally can't reach. The component's own
    // `!issuedToEmail.includes("@")` branch is a second, redundant floor for
    // a value the DOM's format check somehow let through — never the only
    // guard, matching `docs/ui-standards.md`'s own "the server action is
    // always the authoritative validator" rule.
    render(<IssueGrantForm slug="northern-reach" congregations={CONGREGATIONS} />);
    fireEvent.change(screen.getByLabelText(/^recipient name/i), {
      target: { value: "Odalys Fenwick" },
    });
    fireEvent.change(screen.getByLabelText(/^recipient email/i), {
      target: { value: "not-an-email" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /issue grant/i }));
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(mockIssueStatisticsGrantAction).not.toHaveBeenCalled();
  });
});

describe("IssueGrantForm — submission", () => {
  it("calls issueStatisticsGrantAction with the chosen congregation, year, and recipient", async () => {
    mockIssueStatisticsGrantAction.mockResolvedValueOnce({
      ok: true,
      data: { id: "grant-1" },
    });
    render(<IssueGrantForm slug="northern-reach" congregations={CONGREGATIONS} />);

    fireEvent.change(screen.getByLabelText(/^congregation/i), {
      target: { value: "cong-2" },
    });
    fireEvent.change(screen.getByLabelText(/^report year/i), {
      target: { value: "2025" },
    });
    fireEvent.change(screen.getByLabelText(/^recipient name/i), {
      target: { value: "Odalys Fenwick" },
    });
    fireEvent.change(screen.getByLabelText(/^recipient email/i), {
      target: { value: "clerk@marrowbone.example.invalid" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /issue grant/i }));
    });

    expect(mockIssueStatisticsGrantAction).toHaveBeenCalledWith("northern-reach", {
      aboutOrgId: "cong-2",
      reportYear: 2025,
      issuedToName: "Odalys Fenwick",
      issuedToEmail: "clerk@marrowbone.example.invalid",
    });
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("surfaces a failure via toast.error, verbatim — e.g. the translated partial-unique message", async () => {
    mockIssueStatisticsGrantAction.mockResolvedValueOnce({
      ok: false,
      error:
        "A grant is already outstanding for this congregation and year — revoke it first.",
    });
    render(<IssueGrantForm slug="northern-reach" congregations={CONGREGATIONS} />);
    fireEvent.change(screen.getByLabelText(/^recipient name/i), {
      target: { value: "Odalys Fenwick" },
    });
    fireEvent.change(screen.getByLabelText(/^recipient email/i), {
      target: { value: "clerk@quillhaven.example.invalid" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /issue grant/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "A grant is already outstanding for this congregation and year — revoke it first.",
    );
  });
});
