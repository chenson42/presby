import { describe, it, expect } from "vitest";
import {
  ACCOUNT_INVITATION_TEMPLATE_KEY,
  ACCOUNT_SIGN_IN_TEMPLATE_KEY,
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

describe("a congregation's sign-in invitation (Community Increment 2b, purpose sign_in)", () => {
  const signIn = (over: Partial<Parameters<typeof renderInvitationEmail>[0]> = {}) =>
    render({ purpose: "sign_in", senderName: "Beatrix Holloway", firstName: "Wendeline", organizationName: "Quillhaven Fellowship", ...over });

  it("has its own template key, distinct from the designation's", () => {
    expect(ACCOUNT_SIGN_IN_TEMPLATE_KEY).toBe("account_sign_in_invitation");
    expect(ACCOUNT_SIGN_IN_TEMPLATE_KEY).not.toBe(ACCOUNT_INVITATION_TEMPLATE_KEY);
  });

  it("reads the operator-approved copy: subject, heading, greeting, body, second line, button and footnote", () => {
    const { rendered } = signIn();
    const { subject, text } = rendered!.message;
    expect(subject).toBe("Quillhaven Fellowship has invited you to sign in to PresbyPortal");
    expect(text).toContain("You're invited to PresbyPortal");
    expect(text).toContain("Hello Wendeline,");
    expect(text).toContain(
      "Beatrix Holloway at Quillhaven Fellowship has set up a place for you on PresbyPortal, the website your congregation uses to keep its records and do its work. Accepting takes about a minute: you choose a password, and then you can sign in whenever you need to.",
    );
    expect(text).toContain("What you can see and do depends on your role at Quillhaven Fellowship. Accepting doesn't change your role.");
    expect(rendered!.message.html).toContain("Accept the invitation</a>");
    expect(text).toContain(
      "The link works once and expires on October 28, 2026. If you already have a PresbyPortal account, sign in with this email address. If you weren't expecting this, you can ignore it. Nothing happens unless you accept.",
    );
  });

  it("drops the designation's lines: no role grant, and no 'Nobody holds this role'", () => {
    const text = signIn().rendered!.message.text;
    expect(text).not.toMatch(/Nobody holds this role/);
    expect(text).not.toMatch(/administrator/i);
    expect(text).not.toMatch(/treasurer/i);
    expect(text).not.toMatch(/A PresbyPortal administrator has invited you/);
  });

  it("the sender is a person's name from their own record: escaped, control-stripped, capped at 100 characters (the westervillelions lesson)", () => {
    const { rendered } = signIn({ senderName: `<script>alert(1)</script>${"s".repeat(200)}\r\nBcc: x@example.invalid` });
    expect(rendered!.message.html).not.toContain("<script>");
    expect(rendered!.message.html).toContain("&lt;script&gt;");
    expect(rendered!.message.html).not.toMatch(/s{101}/);
    expect(rendered!.message.subject).not.toMatch(/[\r\n]/);
  });

  it("a blank sender name falls back to the congregation so the sentence still reads", () => {
    for (const senderName of [null, undefined, "   "]) {
      const text = signIn({ senderName }).rendered!.message.text;
      expect(text).toContain("Quillhaven Fellowship has set up a place for you on PresbyPortal");
      expect(text).not.toMatch(/ at Quillhaven Fellowship has set up/);
    }
  });

  it("emits the accept URL as an unchanged substring, built from the validated origin only", () => {
    const { rendered, token } = signIn();
    expect(rendered!.url).toBe(`${ORIGIN}/invite?token=${token}`);
    expect(rendered!.message.html).toContain(`href="${rendered!.url}"`);
    expect(rendered!.message.text.split(rendered!.url).length - 1).toBe(1);
  });

  it("the two designations are unchanged by the per-purpose switch (subject and role line, byte for byte)", () => {
    const fa = render().rendered!.message;
    expect(fa.subject).toBe("You're invited to PresbyPortal for Quillhaven Fellowship");
    expect(fa.text).toContain("A PresbyPortal administrator has invited you to be the first administrator for Quillhaven Fellowship.");
    expect(fa.text).toContain("As administrator you will be able to manage people, roles and settings for the congregation.");
    expect(fa.text).toContain("Nobody holds this role until you accept.\nIf you were not expecting this, you can ignore this message.");
    const tr = render({ purpose: "treasurer", senderName: "Ignored Sender" }).rendered!.message;
    expect(tr.text).toContain("A PresbyPortal administrator has invited you to be the treasurer for Quillhaven Fellowship.");
    expect(tr.text).not.toContain("Ignored Sender");
  });

  it("an unknown purpose throws rather than rendering another purpose's text (F196's TypeScript half)", () => {
    expect(() => render({ purpose: "mystery" as never })).toThrow(/Unhandled invitation purpose/);
  });
});
