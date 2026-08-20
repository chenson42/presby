// @vitest-environment jsdom
/**
 * Tests for <AttachmentDisplay> — DECISION-073: images render inline,
 * `application/pdf` is ALWAYS a plain download link, never an
 * `<iframe>`/`<embed>` viewer, regardless of the content type given.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AttachmentDisplay } from "./attachment-display";

afterEach(cleanup);

describe("AttachmentDisplay — images", () => {
  it("renders an <img> pointed at the tenant-scoped attachment route for image/*", () => {
    render(
      <AttachmentDisplay
        slug="alder-creek"
        ticketId="ticket-1"
        attachment={{ key: "blob-1", contentType: "image/png" }}
      />,
    );
    const img = screen.getByRole("img", { name: /attached image/i });
    expect(img.getAttribute("src")).toBe(
      "/o/alder-creek/tickets/ticket-1/attachments/blob-1",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("AttachmentDisplay — PDF", () => {
  it("renders a plain download link, NEVER an inline viewer, for application/pdf", () => {
    render(
      <AttachmentDisplay
        slug="alder-creek"
        ticketId="ticket-1"
        attachment={{ key: "blob-2", contentType: "application/pdf" }}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    const link = screen.getByRole("link", { name: /download attachment \(pdf\)/i });
    expect(link.getAttribute("href")).toBe(
      "/o/alder-creek/tickets/ticket-1/attachments/blob-2",
    );
  });
});
