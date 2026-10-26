// @vitest-environment jsdom
/**
 * The phone menu (E9): a visible "Menu" button of at least 44px; opening shows
 * a titled dialog with the nav; a click on a link closes it (the current-page
 * case); a route change remounts it closed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ADMIN_NAV_GROUPS } from "@/lib/admin-portal/nav";

let pathname = "/admin";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { AdminMobileMenu } from "./admin-mobile-menu";

afterEach(cleanup);

const groups = ADMIN_NAV_GROUPS;

describe("AdminMobileMenu", () => {
  it("renders a visible, text-labelled Menu button at least 44px tall, hidden from md up", () => {
    pathname = "/admin";
    render(<AdminMobileMenu groups={groups} version="9.9.9" />);
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button.className).toContain("min-h-11");
    expect(button.className).toContain("md:hidden");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a dialog titled Platform admin containing the nav and the version", () => {
    pathname = "/admin";
    render(<AdminMobileMenu groups={groups} version="9.9.9" />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));

    const dialog = screen.getByRole("dialog", { name: "Platform admin" });
    expect(dialog).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Platform admin" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tickets" })).toBeTruthy();
    expect(screen.getByText("Version 9.9.9")).toBeTruthy();
  });

  it("closes when the link to the current page is clicked", () => {
    pathname = "/admin";
    render(<AdminMobileMenu groups={groups} version="9.9.9" />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the route changes", () => {
    pathname = "/admin";
    const { rerender } = render(
      <AdminMobileMenu groups={groups} version="9.9.9" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    pathname = "/admin/tickets";
    rerender(<AdminMobileMenu groups={groups} version="9.9.9" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gives the close control a 44px hit area", () => {
    pathname = "/admin";
    render(<AdminMobileMenu groups={groups} version="9.9.9" />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("button", { name: "Close" }).className).toContain("size-11");
  });
});
