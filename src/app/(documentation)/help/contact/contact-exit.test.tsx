// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DOCUMENT_LINK_CLASS } from "@/components/shared/markdown-document";
import { EXTERNAL_LINK_ALLOWLIST } from "@/lib/help/links";
import { HELP_REPOSITORY_URL } from "@/lib/help/contact";
import { HELP_COPY } from "@/lib/help/copy";
import { HELP_CONTACT_EXIT_COPY as EXIT } from "@/lib/help-contact/copy";
import { ContactExit, ContactUnavailable, EXIT_LINK_CLASS } from "./contact-exit";

afterEach(cleanup);

describe("ContactExit (Copy C)", () => {
  it("says to ask the inviter, conditionally, and names the public repository with the public-issues warning", () => {
    render(<ContactExit />);
    const exit = screen.getByTestId("contact-exit");
    expect(exit.textContent).toBe(`${EXIT.line1}${EXIT.line2Lead}${EXIT.line2LinkText}${HELP_COPY.externalCue}${EXIT.line2Tail}`);
    expect(exit.textContent).toContain("Issues there are public");
    expect(exit.textContent).toContain("You need a GitHub account.");
  });

  it("links the repository in a new tab with noopener and a screen-reader cue", () => {
    render(<ContactExit />);
    const link = screen.getByRole("link", { name: /PresbyPortal repository/ });
    expect(link.getAttribute("href")).toBe(HELP_REPOSITORY_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
    expect(within(link).getByText(/opens in a new tab/).className).toContain("sr-only");
  });

  it("the repository URL is one help is allowed to link (H6's allowlist)", () => {
    expect(EXTERNAL_LINK_ALLOWLIST).toContain(HELP_REPOSITORY_URL);
  });

  it("repeats DOCUMENT_LINK_CLASS rather than importing it, so the island never pulls react-markdown into the browser", () => {
    expect(EXIT_LINK_CLASS).toBe(DOCUMENT_LINK_CLASS);
    const src = readFileSync(path.join(__dirname, "contact-exit.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/markdown-document|react-markdown/);
  });
});

describe("ContactUnavailable", () => {
  it("has its heading, its body and the exit, and never the word 'ticket'", () => {
    render(<ContactUnavailable />);
    const block = screen.getByTestId("contact-unavailable");
    expect(within(block).getByRole("heading", { name: EXIT.unavailableHeading })).toBeTruthy();
    expect(block.textContent).toContain(EXIT.unavailableBody);
    expect(within(block).getByTestId("contact-exit")).toBeTruthy();
    expect(block.textContent).not.toMatch(/ticket/i);
  });
});
