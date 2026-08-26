// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Pagination } from "./pagination";

afterEach(cleanup);

const buildHref = (page: number) => `/o/acme/directory?page=${page}`;

describe("Pagination", () => {
  it("renders nothing when there is only one page", () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} buildHref={buildHref} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("disables Previous (renders no link) on page 1", () => {
    render(<Pagination page={1} totalPages={3} buildHref={buildHref} />);
    expect(
      screen.queryByRole("link", { name: "Previous" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Next" })).toBeTruthy();
  });

  it("disables Next (renders no link) on the last page", () => {
    render(<Pagination page={3} totalPages={3} buildHref={buildHref} />);
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
    expect(screen.getByRole("link", { name: "Previous" })).toBeTruthy();
  });

  it("both Previous and Next link on a middle page, to the correct hrefs", () => {
    render(<Pagination page={2} totalPages={3} buildHref={buildHref} />);
    expect(
      screen.getByRole("link", { name: "Previous" }).getAttribute("href"),
    ).toBe("/o/acme/directory?page=1");
    expect(
      screen.getByRole("link", { name: "Next" }).getAttribute("href"),
    ).toBe("/o/acme/directory?page=3");
  });

  it("shows the current page and total", () => {
    render(<Pagination page={2} totalPages={5} buildHref={buildHref} />);
    expect(screen.getByText("Page 2 of 5")).toBeTruthy();
  });
});
