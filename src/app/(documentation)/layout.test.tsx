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

  it("ends every help page with a way out: a 44px link to the contact form, named for its destination", () => {
    const { container } = render(<DocumentationLayout>x</DocumentationLayout>);
    const footer = container.querySelector("footer") as HTMLElement;
    expect(footer).toBeTruthy();
    expect(footer.textContent).toBe("Can't find what you need?Write to the PresbyPortal team");
    const link = screen.getByRole("link", { name: "Write to the PresbyPortal team" });
    expect(link.getAttribute("href")).toBe("/help/contact");
    expect(link.className).toContain("min-h-11");
    // After <main>, so the skip link and the page body come first.
    expect(container.querySelector("main")?.nextElementSibling).toBe(footer);
  });

  it("hides the footer in print, like the header", () => {
    const { container } = render(<DocumentationLayout>x</DocumentationLayout>);
    expect(container.querySelector("footer")?.className).toContain("print:hidden");
  });
});
