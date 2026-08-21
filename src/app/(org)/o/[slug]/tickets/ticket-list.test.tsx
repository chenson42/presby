// @vitest-environment jsdom
/**
 * Tests for <TicketList> — the "Open tickets" table.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TicketList } from "./ticket-list";
import type { TicketListEntry } from "@/lib/tickets";

afterEach(cleanup);

const TICKET: TicketListEntry = {
  ticketId: "ticket-1",
  subject: "Directory search does not find members by maiden name",
  changeClass: "bug",
  area: "directory",
  priority: "urgent",
  status: "new",
  submitterDisplayName: "Desmond Okonkwo",
  createdAt: "2026-08-15T14:22:00Z",
  lastActivityAt: "2026-08-15T14:22:00Z",
  messageCount: 1,
};

describe("TicketList — empty state", () => {
  it("renders real copy, not a blank screen, when there are zero tickets", () => {
    render(<TicketList tickets={[]} slug="alder-creek" />);
    expect(screen.getByText(/no tickets yet/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("TicketList — populated", () => {
  it("renders a table row per ticket, linking to the ticket's thread", () => {
    render(<TicketList tickets={[TICKET]} slug="alder-creek" />);
    expect(screen.getByRole("table")).toBeTruthy();
    const link = screen.getByRole("link", {
      name: /directory search does not find members by maiden name/i,
    });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/tickets/ticket-1");
  });

  it("renders the priority and status as labeled badges, not bare values", () => {
    render(<TicketList tickets={[TICKET]} slug="alder-creek" />);
    expect(screen.getByText("Urgent")).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
  });

  it("shows the submitter's display name", () => {
    render(<TicketList tickets={[TICKET]} slug="alder-creek" />);
    expect(screen.getByText("Desmond Okonkwo")).toBeTruthy();
  });

  it("truncates a long subject instead of overflowing the column, keeping the full text available via title", () => {
    const longSubject =
      "The projector in the fellowship hall stopped connecting to the laptop during the Wednesday evening potluck and nobody could find the right adapter";
    const longTicket: TicketListEntry = { ...TICKET, subject: longSubject };
    render(<TicketList tickets={[longTicket]} slug="alder-creek" />);
    const link = screen.getByRole("link", { name: longSubject });
    expect(link.className).toContain("truncate");
    expect(link.getAttribute("title")).toBe(longSubject);
  });
});
