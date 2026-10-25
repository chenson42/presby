// @vitest-environment jsdom
/**
 * CountCard (E7): zero and failure are different states with different icons
 * and words; the attention state says "Needs attention" in words; the whole
 * card is the link, except in the error state, which has no nested links.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Ticket } from "lucide-react";
import { CountCard, CountCardSkeleton } from "./count-card";

afterEach(cleanup);

const base = { title: "Tickets", icon: Ticket, href: "/admin/tickets" };

describe("CountCard", () => {
  it("is one link to the default destination, with the title as an h3", () => {
    render(
      <CountCard
        {...base}
        state={{ kind: "ok", tone: "attention", headline: "2 new tickets", lines: ["1 open and not assigned"] }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/admin/tickets");
    expect(screen.getByRole("heading", { level: 3, name: "Tickets" })).toBeTruthy();
    expect(screen.getByText("2 new tickets")).toBeTruthy();
    expect(screen.getByText("1 open and not assigned")).toBeTruthy();
  });

  it("uses the state's own href over the default", () => {
    render(
      <CountCard
        {...base}
        state={{ kind: "ok", tone: "attention", headline: "x", href: "/admin/tickets?status=new" }}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe("/admin/tickets?status=new");
  });

  it("says Needs attention in words and borders the card for attention", () => {
    const { container } = render(
      <CountCard {...base} state={{ kind: "ok", tone: "attention", headline: "x" }} />,
    );
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(container.querySelector(".border-foreground")).toBeTruthy();
  });

  it("shows the clear state without the attention words", () => {
    const { container } = render(
      <CountCard {...base} state={{ kind: "ok", tone: "clear", headline: "Nothing waiting." }} />,
    );
    expect(screen.getByText("Nothing waiting.")).toBeTruthy();
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(container.querySelector(".border-foreground")).toBeNull();
  });

  it("neutral has no status row", () => {
    render(
      <CountCard {...base} state={{ kind: "ok", tone: "neutral", headline: "12 organizations" }} />,
    );
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.queryByText("Nothing waiting.")).toBeNull();
  });

  it("renders a failure as its own state, never as zero or all-clear (E5, E7)", () => {
    render(<CountCard {...base} state={{ kind: "error", retryHref: "/admin" }} />);
    expect(screen.getByText("We can't load this right now.")).toBeTruthy();
    expect(screen.queryByText("Nothing waiting.")).toBeNull();
    expect(screen.queryByText(/^0/)).toBeNull();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1); // no nested links: only "Try again"
    expect(links[0].textContent).toBe("Try again");
    expect(links[0].getAttribute("href")).toBe("/admin");
    expect(links[0].className).toContain("min-h-11");
  });

  it("the skeleton announces what is loading", () => {
    render(<CountCardSkeleton title="Tickets" />);
    expect(screen.getByText("Loading Tickets")).toBeTruthy();
  });
});
