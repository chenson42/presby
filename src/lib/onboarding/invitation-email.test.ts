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
    const { url, html, text } = rendered!;
    expect(html).toContain(`href="${url}"`);
    // href + printed copy: two occurrences in the html.
    expect(html.split(url).length - 1).toBe(2);
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
    expect(rendered!.html).not.toContain("<script>");
    expect(rendered!.html).not.toContain("<img");
    expect(rendered!.html).toContain("&lt;script&gt;");
    expect(rendered!.html).toContain("&amp; Co");
    // The cap applies to each interpolated name.
    expect(rendered!.html).not.toMatch(/x{101}/);
    expect(rendered!.html).not.toMatch(/y{101}/);
  });

  it("strips control characters and newlines from names (header and layout injection)", () => {
    const { rendered } = render({ firstName: "Marie\r\nBcc: x@example.invalid", organizationName: "Org\u0000Name" });
    expect(rendered!.text.split("\n")[0]).toBe("Hello Marie Bcc: x@example.invalid,");
    expect(rendered!.subject).not.toMatch(/[\r\n\u0000]/);
  });

  it("falls back to a plain greeting without a name", () => {
    expect(render({ firstName: null }).rendered!.text.startsWith("Hello,\n")).toBe(true);
    expect(render({ firstName: "   " }).rendered!.text.startsWith("Hello,\n")).toBe(true);
  });

  it("describes the role in plain words per purpose and states that nobody holds it until acceptance", () => {
    expect(render().rendered!.text).toContain("the first administrator");
    const treasurer = render({ purpose: "treasurer" }).rendered!;
    expect(treasurer.text).toContain("the treasurer");
    expect(treasurer.text).toContain("Nobody holds this role until you accept.");
  });

  it("states the expiry date in UTC", () => {
    const { rendered } = render();
    expect(rendered!.text).toContain("expires on October 28, 2026");
  });

  it("never contains the invited address (the render takes none)", () => {
    const { rendered } = render();
    expect(rendered!.html).not.toMatch(/@example\.invalid/);
    expect(rendered!.text).not.toMatch(/@example\.invalid/);
  });
});
