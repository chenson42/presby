// @vitest-environment jsdom
/**
 * /totp: the help link (user-help Inc 1, Copy C3). Auth-touching page, so the running-server
 * smoke covers it too (help-gates.spec.ts); this pins the link and that the page still sends a
 * person with no enrolment to /account/2fa without rendering it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mockAuth = vi.fn();
const findFirst = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/auth", () => ({ auth: () => mockAuth() }));
vi.mock("@/lib/db", () => ({ db: { query: { userTotp: { findFirst: (...a: unknown[]) => findFirst(...a) } } } }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
vi.mock("./totp-challenge-form", () => ({ TotpChallengeForm: () => <form data-testid="challenge" /> }));

import TotpPage from "./page";

beforeEach(() => {
  mockAuth.mockResolvedValue({ user: { id: "u1" } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/totp", () => {
  it("shows 'Help with two-factor sign-in' linking to using-your-code, under the form", async () => {
    findFirst.mockResolvedValue({ userId: "u1" });
    render(await TotpPage({ searchParams: Promise.resolve({}) }));

    const link = screen.getByRole("link", { name: "Help with two-factor sign-in" });
    expect(link.getAttribute("href")).toBe("/help/using-your-code");
    const form = screen.getByTestId("challenge");
    expect(form.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("still sends a person with no enrolment to /account/2fa", async () => {
    findFirst.mockResolvedValue(undefined);
    await expect(TotpPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/REDIRECT:\/account\/2fa/);
  });
});
