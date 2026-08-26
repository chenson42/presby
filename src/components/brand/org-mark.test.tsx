// @vitest-environment jsdom
/**
 * Tests for <OrgMark> / <OrgWordmark> — P0.5 slice c, commit `c3`.
 *
 * G7's fallback cascade is the thing worth pinning: an image when one
 * exists, initials (from src/lib/initials.ts, not reimplemented) for the
 * square mark when it does not, and the organization's own name — never a
 * building glyph, never a cross — when there is nothing to show at all.
 *
 * No jest-dom matchers: this repo's existing component specs
 * (avatar-menu.test.tsx) use plain vitest/chai assertions against
 * Testing Library queries, and this file follows the same convention.
 */

import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OrgMark, OrgWordmark } from "./org-mark";

afterEach(cleanup);

describe("OrgMark", () => {
  it("renders the mark image with the org name in its alt text when markSrc is provided", () => {
    render(
      <OrgMark
        name="Alder Creek Presbyterian Church"
        markSrc="data:image/png;base64,AAAA"
      />,
    );
    const img = screen.getByRole("img", {
      name: "Alder Creek Presbyterian Church logo",
    });
    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });

  it("falls back to initials when no mark image is supplied", () => {
    render(<OrgMark name="Alder Creek Presbyterian Church" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("AC")).toBeTruthy();
  });

  it("never renders a building glyph or cross fallback — text only", () => {
    const { container } = render(<OrgMark name="Bramblewood" />);
    // No <svg> icon in the no-image branch — the fallback is initials text.
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("OrgWordmark", () => {
  it("prefers the wordmark image over the mark image", () => {
    render(
      <OrgWordmark
        name="Bramblewood Presbyterian Church"
        markSrc="data:image/png;base64,MARK"
        wordmarkSrc="data:image/png;base64,WORD"
      />,
    );
    const img = screen.getByRole("img", {
      name: "Bramblewood Presbyterian Church logo",
    });
    expect(img.getAttribute("src")).toBe("data:image/png;base64,WORD");
  });

  it("falls back to the mark image when no wordmark exists", () => {
    render(
      <OrgWordmark
        name="Bramblewood Presbyterian Church"
        markSrc="data:image/png;base64,MARK"
      />,
    );
    const img = screen.getByRole("img", {
      name: "Bramblewood Presbyterian Church logo",
    });
    expect(img.getAttribute("src")).toBe("data:image/png;base64,MARK");
  });

  it("falls back to the organization's name as text when neither image exists (G7's typographic fallback)", () => {
    render(<OrgWordmark name="Quillhaven Presbyterian Church" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Quillhaven Presbyterian Church")).toBeTruthy();
  });

  it("carries the neutral plate (G7) by default — no caller has to remember to ask for it", () => {
    render(
      <OrgWordmark
        name="Bramblewood Presbyterian Church"
        markSrc="data:image/png;base64,MARK"
      />,
    );
    const img = screen.getByRole("img", {
      name: "Bramblewood Presbyterian Church logo",
    });
    expect(img.closest("div")?.className).toContain("bg-white");
  });

  it("drops the plate only when a caller explicitly opts out (plate={false})", () => {
    render(
      <OrgWordmark
        name="Bramblewood Presbyterian Church"
        markSrc="data:image/png;base64,MARK"
        plate={false}
      />,
    );
    const img = screen.getByRole("img", {
      name: "Bramblewood Presbyterian Church logo",
    });
    expect(img.closest("div")?.className).not.toContain("bg-white");
  });
});
