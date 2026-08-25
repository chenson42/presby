// @vitest-environment jsdom
/**
 * Orchestration test for the client-side half of find-a-person: does the
 * form call the action with the trimmed query and navigate to whatever href
 * it returns? The action's own zero/one/many/forbidden branching is tested
 * in `find-person-action.test.ts`, unmocked here on purpose — this file
 * only proves the wiring between the two.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const findPersonAction = vi.fn();
vi.mock("@/app/(org)/o/[slug]/find-person-action", () => ({
  findPersonAction: (...args: unknown[]) => findPersonAction(...args),
}));

import { FindPersonForm } from "./find-person-form";

afterEach(() => {
  cleanup();
  push.mockClear();
  findPersonAction.mockReset();
});

describe("FindPersonForm", () => {
  it("does not call the action for a blank query", () => {
    render(<FindPersonForm slug="alder-creek" />);
    fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
    expect(findPersonAction).not.toHaveBeenCalled();
  });

  it("trims the query and navigates to whatever href the action returns", async () => {
    findPersonAction.mockResolvedValue({
      kind: "fallthrough",
      href: "/o/alder-creek/directory?search=marguerite",
    });
    render(<FindPersonForm slug="alder-creek" />);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "  marguerite  " },
    });
    fireEvent.submit(screen.getByRole("searchbox").closest("form")!);

    await waitFor(() => expect(push).toHaveBeenCalledWith(
      "/o/alder-creek/directory?search=marguerite",
    ));
    expect(findPersonAction).toHaveBeenCalledWith("alder-creek", "marguerite");
  });

  it("navigates on a redirect-kind result the same way as fallthrough", async () => {
    findPersonAction.mockResolvedValue({
      kind: "redirect",
      href: "/o/alder-creek/directory?search=unique",
    });
    render(<FindPersonForm slug="alder-creek" />);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "unique" } });
    fireEvent.submit(screen.getByRole("searchbox").closest("form")!);

    await waitFor(() => expect(push).toHaveBeenCalledWith(
      "/o/alder-creek/directory?search=unique",
    ));
  });
});
