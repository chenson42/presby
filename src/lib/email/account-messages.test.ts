import { describe, expect, it } from "vitest";
import { buildEmailChangeVerifyEmail, buildPasswordResetEmail } from "./account-messages";

const RESET = "https://app.example.invalid/reset-password?token=abc_DEF-123&x=1";
const VERIFY = "https://app.example.invalid/account/verify-email/0123abcd";

describe("buildPasswordResetEmail", () => {
  const m = buildPasswordResetEmail({ resetUrl: RESET });

  it("keeps the 60 minute expiry the action mints, and the safety footnote", () => {
    expect(m.subject).toBe("Reset your password");
    expect(m.html).toContain("This link expires in 60 minutes.");
    expect(m.text).toContain("This link expires in 60 minutes.");
    expect(m.text).toContain("If you did not request this, you can safely ignore this email.");
  });

  it("links the URL unchanged in href, in the printed link and in text, with a button label", () => {
    const escaped = RESET.replace(/&/g, "&amp;");
    expect(m.html).toContain(`href="${escaped}"`);
    expect(m.html).toContain(`>${escaped}</a>`);
    expect(m.text).toContain(`\n${RESET}\n`);
    expect(m.html).toContain(">Reset your password</a>");
  });
});

describe("buildEmailChangeVerifyEmail", () => {
  it("names the new address, the 24 hour expiry and the link", () => {
    const m = buildEmailChangeVerifyEmail({ newEmail: "new.person@example.invalid", verifyUrl: VERIFY });
    expect(m.subject).toBe("Confirm your new email address");
    expect(m.html).toContain("new.person@example.invalid");
    expect(m.text).toContain("sign-in email address to new.person@example.invalid.");
    expect(m.text).toContain("This link expires in 24 hours.");
    expect(m.html).toContain(`href="${VERIFY}"`);
    expect(m.text).toContain(`\n${VERIFY}\n`);
  });

  it("escapes a hostile new address in html and keeps it raw in text - regression for F161 unescaped newEmail", () => {
    const hostile = "<img src=x onerror=1>@example.invalid";
    const m = buildEmailChangeVerifyEmail({ newEmail: hostile, verifyUrl: VERIFY });
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img src=x onerror=1&gt;@example.invalid");
    expect(m.text).toContain(hostile);
  });

  it("escapes an ampersand once in html and leaves it raw in text", () => {
    const m = buildEmailChangeVerifyEmail({ newEmail: "a&b@example.invalid", verifyUrl: VERIFY });
    expect(m.html).toContain("a&amp;b@example.invalid");
    expect(m.html).not.toContain("&amp;amp;");
    expect(m.text).toContain("a&b@example.invalid");
  });
});
