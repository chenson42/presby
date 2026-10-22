import { describe, it, expect } from "vitest";
import {
  ACCOUNT_INVITATION_TEMPLATE_KEY,
  renderInvitationEmail,
} from "./invitation-email";
import { mintInvitationToken } from "./invitation-token";

const ORIGIN = "https://app.example.invalid";

function render(overrides: Partial<Parameters<typeof renderInvitationEmail>[0]> = {}) {
  const { token } = mintInvitationToken();
  const rendered = renderInvitationEmail({
    firstName: "Marie",
    organizationName: "Quillhaven Fellowship",
    purpose: "founding_administrator",
    token,
    expiresAt: new Date("2026-10-28T12:00:00Z"),
    origin: ORIGIN,
    ...overrides,
  });
  return { rendered, token };
}

describe("renderInvitationEmail", () => {
  it("uses the registered template key", () => {
    expect(ACCOUNT_INVITATION_TEMPLATE_KEY).toBe("account_invitation");
  });

  it("builds the link from the supplied origin and the token, and nothing else", () => {
    const { rendered, token } = render();
    expect(rendered!.url).toBe(`${ORIGIN}/invite?token=${token}`);
  });

  it("emits the accept URL as an unchanged substring in the href, the printed copy and the text", () => {
    const { rendered } = render();
    const { url } = rendered!;
    const { html, text } = rendered!.message;
    expect(html).toContain(`href="${url}"`);
    // button href, printed link's href, printed link text: three in the html.
    expect(html.split(url).length - 1).toBe(3);
    expect(text).toContain(url);
    expect(text.split(url).length - 1).toBe(1);
  });

  it("returns null when there is no safe platform origin", () => {
    const { rendered } = render({ origin: null });
    expect(rendered).toBeNull();
  });

  it("falls back to platformOrigin() when no origin is injected, and never to a request host", () => {
    const { rendered, token } = render({ origin: undefined });
    // Test env: NODE_ENV is not production, so the unset-env fallback is localhost.
    expect(rendered!.url.endsWith(`/invite?token=${token}`)).toBe(true);
  });

  it("greets by first name, escapes it, and caps names at 100 characters", () => {
    const { rendered } = render({
      firstName: `<script>alert(1)</script>${"x".repeat(200)}`,
      organizationName: `<img src=x onerror=alert(1)> & Co ${"y".repeat(200)}`,
    });
    expect(rendered!.message.html).not.toContain("<script>");
    expect(rendered!.message.html).not.toContain("<img");
    expect(rendered!.message.html).toContain("&lt;script&gt;");
    expect(rendered!.message.html).toContain("&amp; Co");
    // The cap applies to each interpolated name.
    expect(rendered!.message.html).not.toMatch(/x{101}/);
    expect(rendered!.message.html).not.toMatch(/y{101}/);
  });

  it("strips control characters and newlines from names (header and layout injection)", () => {
    const { rendered } = render({ firstName: "Marie\r\nBcc: x@example.invalid", organizationName: "Org\u0000Name" });
    expect(rendered!.message.text).toContain("\n\nHello Marie Bcc: x@example.invalid,\n\n");
    expect(rendered!.message.subject).not.toMatch(/[\r\n\u0000]/);
  });

  it("falls back to a plain greeting without a name", () => {
    expect(render({ firstName: null }).rendered!.message.text).toContain("\n\nHello,\n\n");
    expect(render({ firstName: "   " }).rendered!.message.text).toContain("\n\nHello,\n\n");
  });

  it("describes the role in plain words per purpose and states that nobody holds it until acceptance", () => {
    expect(render().rendered!.message.text).toContain("the first administrator");
    const treasurer = render({ purpose: "treasurer" }).rendered!.message;
    expect(treasurer.text).toContain("the treasurer");
    expect(treasurer.text).toContain("Nobody holds this role until you accept.");
  });

  it("states the expiry date in UTC", () => {
    const { rendered } = render();
    expect(rendered!.message.text).toContain("expires on October 28, 2026");
  });

  it("is a branded RenderedEmail: the action button, the printed link, no sender text", () => {
    const { rendered } = render();
    const { html, text, subject } = rendered!.message;
    expect(subject).toBe("You're invited to PresbyPortal for Quillhaven Fellowship");
    expect(html).toContain("Accept the invitation</a>");
    expect(html).toContain("copy and paste this link into your browser");
    expect(text).toContain("Hello Marie,");
  });

  it("never contains the invited address (the render takes none)", () => {
    const { rendered } = render();
    expect(rendered!.message.html).not.toMatch(/@example\.invalid/);
    expect(rendered!.message.text).not.toMatch(/@example\.invalid/);
  });
});
