// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DocumentationLayout from "./layout";

afterEach(cleanup);

describe("documentation layout", () => {
  it("renders chrome with a skip link to the main landmark and the three header links", () => {
    const { container } = render(
      <DocumentationLayout>
        <p>body</p>
      </DocumentationLayout>,
    );
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(skip.getAttribute("href")).toBe("#help-main");
    const main = container.querySelector("main") as HTMLElement;
    expect(main.id).toBe("help-main");
    expect(main.getAttribute("tabindex")).toBe("-1");
    expect(main.textContent).toBe("body");
    expect(screen.getByRole("link", { name: "PresbyPortal" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Help" }).getAttribute("href")).toBe("/help");
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/signin");
    expect(screen.getByRole("link", { name: "Open PresbyPortal" }).getAttribute("href")).toBe("/launch");
  });

  it("wraps the header row at 360px instead of hiding a link, and keeps every link a 44px target", () => {
    const { container } = render(<DocumentationLayout>x</DocumentationLayout>);
    expect(container.querySelector("header > div")?.className).toContain("flex-wrap");
    expect(container.querySelector("nav")?.className).toContain("flex-wrap");
    for (const name of ["Help", "Sign in", "Open PresbyPortal", "PresbyPortal"]) {
      expect(screen.getByRole("link", { name }).className, name).toContain("min-h-11");
    }
  });

  it("shows the same chrome to everyone: it reads no session (a signed-in reader still sees Sign in)", () => {
    render(<DocumentationLayout>x</DocumentationLayout>);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });

  it("hides the header in print", () => {
    const { container } = render(<DocumentationLayout>x</DocumentationLayout>);
    expect(container.querySelector("header")?.className).toContain("print:hidden");
  });
});
