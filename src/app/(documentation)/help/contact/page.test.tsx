// @vitest-environment jsdom
/**
 * The static page decides ONE thing at build: configured or unavailable (DECISION-303).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HELP_CONTACT_EXIT_COPY as EXIT, HELP_CONTACT_FORM_COPY as COPY } from "@/lib/help-contact/copy";

vi.mock("./actions", () => ({ submitHelpContactAction: vi.fn() }));
vi.mock("@/components/shared/turnstile", () => ({ Turnstile: () => <div data-testid="widget" /> }));

import HelpContactPage, { dynamic, metadata } from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("/help/contact page", () => {
  it('is static: dynamic = "error", with its title as metadata', () => {
    expect(dynamic).toBe("error");
    expect(metadata.title).toBe(COPY.title);
  });

  it("configured: the h1, both intro paragraphs, the form and the noscript exit", () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "dev-secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "dev-site");
    render(<HelpContactPage />);
    expect(screen.getByRole("heading", { level: 1, name: COPY.title })).toBeTruthy();
    expect(screen.getByText(COPY.intro1)).toBeTruthy();
    expect(screen.getByText(COPY.intro2)).toBeTruthy();
    expect(screen.getByTestId("contact-form")).toBeTruthy();
    expect(screen.queryByTestId("contact-unavailable")).toBeNull();
  });

  it("not configured: the unavailable block with its exit, no form, and no promise in the intro", () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    render(<HelpContactPage />);
    expect(screen.getByRole("heading", { level: 1, name: COPY.title })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: EXIT.unavailableHeading })).toBeTruthy();
    expect(screen.getByTestId("contact-exit")).toBeTruthy();
    expect(screen.queryByTestId("contact-form")).toBeNull();
    expect(screen.queryByText(COPY.intro1)).toBeNull();
  });
});
