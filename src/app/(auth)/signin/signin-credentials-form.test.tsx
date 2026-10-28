// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({ signInWithCredentials: vi.fn() }));
vi.mock("@/components/shared/turnstile", () => ({ Turnstile: () => null }));

import { SignInCredentialsForm } from "./signin-credentials-form";

afterEach(cleanup);

describe("SignInCredentialsForm", () => {
  // regression for the starter's own address shown to every visitor (F-new-o). The email box is the
  // first thing anyone sees on /signin, so its example must be an obviously fictional address on a
  // reserved example domain, never a real or starter address.
  it("shows a fictional example address in the email box — regression for the starter's address placeholder", () => {
    render(<SignInCredentialsForm callbackUrl="/launch" />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    const placeholder = email.getAttribute("placeholder") ?? "";
    expect(placeholder).toBe("you@example.org");
    expect(placeholder).not.toMatch(/claudecode/i);
    expect(placeholder).toMatch(/@example\.(org|com|net|invalid)$/);
  });

  it("leaves the email box empty so nothing looks pre-filled", () => {
    render(<SignInCredentialsForm callbackUrl="/launch" />);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("");
  });
});
