// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EmptyState } from "./empty-state";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders title, body and action in a dashed block", () => {
    const { container } = render(
      <EmptyState title="None yet" body="Create one." action={<a href="/new">New</a>} />,
    );
    expect(screen.getByText("None yet")).toBeTruthy();
    expect(screen.getByText("Create one.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "New" })).toBeTruthy();
    expect((container.firstChild as HTMLElement).className).toContain("border-dashed");
  });

  it("omits the body and action when not given", () => {
    const { container } = render(<EmptyState title="Nothing" />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
