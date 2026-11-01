import { describe, expect, it } from "vitest";
import { EXTERNAL_LINK_ALLOWLIST, linkContext, resolveLink } from "./links";
import type { HelpEntry } from "./types";

const content = (slug: string, status: "published" | "pending", extra = {}): HelpEntry => ({
  status,
  slug,
  title: slug,
  summary: "s",
  order: 1,
  audience: "everyone",
  covers: [],
  labels: [],
  verifiedIn: status === "published" ? "0.47.0" : null,
  ...(status === "pending" ? { requires: "tok" } : {}),
  ...extra,
});
const planned = (slug: string): HelpEntry => ({
  status: "planned",
  slug,
  title: slug,
  summary: "s",
  order: 1,
  forWhom: "w",
  today: "t",
  confirmedOn: "2026-10-26",
});

const ctx = linkContext([
  content("signing-in", "published", { anchors: ["forgot-password"] }),
  content("later-page", "pending"),
  planned("worship-planning"),
]);

describe("resolveLink", () => {
  it("admits the fixed internal routes", () => {
    for (const href of ["/help", "/help/planned", "/help/contact", "/launch", "/signin"]) {
      expect(resolveLink(href, ctx)).toEqual({ kind: "internal", href });
    }
  });
  it("admits /help/contact exactly: no anchor, no sub-path, no query (it is a route, not a page)", () => {
    expect(resolveLink("/help/contact", ctx)).toEqual({ kind: "internal", href: "/help/contact" });
    for (const href of ["/help/contact#x", "/help/contact/x", "/help/contact?x=1", "/help/contact/"]) {
      expect(resolveLink(href, ctx), href).toBeNull();
    }
  });
  it("admits a published slug, with a declared anchor", () => {
    expect(resolveLink("/help/signing-in", ctx)).toEqual({ kind: "internal", href: "/help/signing-in" });
    expect(resolveLink("/help/signing-in#forgot-password", ctx)).toEqual({
      kind: "internal",
      href: "/help/signing-in#forgot-password",
    });
  });
  it("refuses an undeclared anchor", () => {
    expect(resolveLink("/help/signing-in#nope", ctx)).toBeNull();
  });
  it("refuses a pending slug unless includePending (a pending page may link its sibling)", () => {
    expect(resolveLink("/help/later-page", ctx)).toBeNull();
    expect(resolveLink("/help/later-page", ctx, { includePending: true })).toEqual({
      kind: "internal",
      href: "/help/later-page",
    });
  });
  it("admits a planned slug only under /help/planned/", () => {
    expect(resolveLink("/help/planned/worship-planning", ctx)).toEqual({
      kind: "internal",
      href: "/help/planned/worship-planning",
    });
    expect(resolveLink("/help/worship-planning", ctx)).toBeNull();
    expect(resolveLink("/help/planned/nope", ctx)).toBeNull();
  });
  it("refuses unknown slugs, queries, trailing slashes and look-alikes", () => {
    for (const href of [
      "/help/unknown",
      "/help/signing-in?x=1",
      "/help/signing-in/",
      "/helpdesk",
      "/help/",
      "/HELP",
      "//evil.invalid/help",
      "/o/alder-creek",
    ]) {
      expect(resolveLink(href, ctx), href).toBeNull();
    }
  });
  it("refuses javascript:, data:, mailto:, http: and protocol-relative links", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,x",
      "mailto:a@b.invalid",
      "http://github.com/chenson42/presby",
      "//github.com/chenson42/presby",
    ]) {
      expect(resolveLink(href, ctx), href).toBeNull();
    }
  });
  it("admits only allowlisted https URLs, as external", () => {
    expect(EXTERNAL_LINK_ALLOWLIST.length).toBeGreaterThan(0);
    const allowed = EXTERNAL_LINK_ALLOWLIST[0];
    expect(resolveLink(allowed, ctx)).toEqual({ kind: "external", href: allowed });
    expect(resolveLink(`${allowed}/`, ctx)).toEqual({ kind: "external", href: `${allowed}/` });
    expect(resolveLink("https://example.invalid/", ctx)).toBeNull();
    expect(resolveLink(`${allowed}?utm=1`, ctx)).toBeNull();
    // credentials on an otherwise allowlisted URL
    expect(resolveLink(allowed.replace("https://", "https://user:pw@"), ctx)).toBeNull();
  });
});

describe("resolveLink — the privacy contact mailto", () => {
  const withContact = linkContext([content("signing-in", "published")], "privacy@example.invalid");

  it("admits exactly mailto:<the configured address>, as an email link", () => {
    expect(resolveLink("mailto:privacy@example.invalid", withContact)).toEqual({
      kind: "email",
      href: "mailto:privacy@example.invalid",
    });
  });

  it("refuses any other mailto:, a query on it, and the address with no scheme", () => {
    for (const href of [
      "mailto:other@example.invalid",
      "mailto:privacy@example.invalid?subject=hi",
      "mailto:privacy@example.invalid,other@example.invalid",
      "MAILTO:privacy@example.invalid",
      "privacy@example.invalid",
    ]) {
      expect(resolveLink(href, withContact), href).toBeNull();
    }
  });

  it("refuses every mailto: when no address is configured", () => {
    expect(resolveLink("mailto:privacy@example.invalid", ctx)).toBeNull();
    expect(resolveLink("mailto:privacy@example.invalid", linkContext([], null))).toBeNull();
  });
});
