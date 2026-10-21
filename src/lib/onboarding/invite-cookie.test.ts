/**
 * The hand-off cookie's contract (Phase 2 addendum 2): host-only, `Path=/`,
 * httpOnly, `SameSite=Lax`, 30 minutes, `Secure` in production, and named
 * `__Host-invite_token` in production / `invite_token` elsewhere. The path is
 * `/` because a server-action redirect renders its target inside the action's
 * own POST, so the page that needs the cookie sees only the cookies scoped to
 * the ACTION's path (`/signin`, `/totp`) - the cookie used to be `Path=/invite`
 * and the invitee was shown the dead-link page after a correct sign-in.
 */
import { describe, expect, it } from "vitest";
import {
  INVITE_COOKIE_MAX_AGE_SECONDS,
  INVITE_PAGE_PATH,
  inviteCookieOptions,
  inviteTokenCookieName,
} from "./invite-cookie";

describe("inviteCookieOptions", () => {
  it("is Path=/ - regression for the dead-link flash after sign-in (the cookie was Path=/invite)", () => {
    expect(inviteCookieOptions({ NODE_ENV: "development" }).path).toBe("/");
    expect(inviteCookieOptions({ NODE_ENV: "production" }).path).toBe("/");
  });

  it("never carries a domain attribute (host-only; a domain would void the __Host- prefix)", () => {
    for (const env of ["development", "test", "production"]) {
      expect(Object.keys(inviteCookieOptions({ NODE_ENV: env }))).not.toContain("domain");
    }
  });

  it("is httpOnly, SameSite=Lax, 30 minutes, and Secure only in production", () => {
    expect(inviteCookieOptions({ NODE_ENV: "development" })).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 1800,
    });
    expect(INVITE_COOKIE_MAX_AGE_SECONDS).toBe(1800);
    expect(inviteCookieOptions({ NODE_ENV: "production" })).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" });
  });
});

describe("inviteTokenCookieName", () => {
  it("is __Host-invite_token in production and invite_token everywhere else", () => {
    expect(inviteTokenCookieName({ NODE_ENV: "production" })).toBe("__Host-invite_token");
    expect(inviteTokenCookieName({ NODE_ENV: "development" })).toBe("invite_token");
    expect(inviteTokenCookieName({ NODE_ENV: "test" })).toBe("invite_token");
    expect(inviteTokenCookieName({})).toBe("invite_token");
  });

  it("the __Host- name is only ever paired with options the prefix accepts (Secure, Path=/, no Domain)", () => {
    const options = inviteCookieOptions({ NODE_ENV: "production" });
    expect(inviteTokenCookieName({ NODE_ENV: "production" }).startsWith("__Host-")).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.path).toBe("/");
    expect("domain" in options).toBe(false);
  });
});

describe("INVITE_PAGE_PATH", () => {
  it("is the page every redirect returns to, and is NOT the cookie's path", () => {
    expect(INVITE_PAGE_PATH).toBe("/invite");
    expect(inviteCookieOptions().path).not.toBe(INVITE_PAGE_PATH);
  });
});
