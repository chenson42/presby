// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { contrastRatio } from "@/lib/brand/contrast";
import {
  GOOGLE_BUTTON,
  GSI_STYLE,
  GoogleSignInButton,
} from "./google-sign-in-button";

afterEach(cleanup);

describe("GoogleSignInButton", () => {
  it("is a submit button named 'Sign in with Google'", () => {
    render(<GoogleSignInButton />);
    const button = screen.getByRole("button", { name: "Sign in with Google" });
    expect(button.getAttribute("type")).toBe("submit");
  });

  it("marks the G logo decorative so the label is the only accessible name", () => {
    const { container } = render(<GoogleSignInButton />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.querySelectorAll("path")).toHaveLength(4);
  });

  it("keeps a 44px touch target", () => {
    render(<GoogleSignInButton />);
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }).className,
    ).toContain("min-h-[44px]");
  });

  it("carries every --gsi-* property inline, with Google's published values", () => {
    render(<GoogleSignInButton />);
    const el = screen.getByRole("button", { name: "Sign in with Google" });
    for (const [prop, value] of Object.entries(GSI_STYLE)) {
      expect(el.style.getPropertyValue(prop)).toBe(value);
    }
    expect(el.style.getPropertyValue("--gsi-fill")).toBe("#FFFFFF");
    expect(el.style.getPropertyValue("--gsi-stroke")).toBe("#747775");
    expect(el.style.getPropertyValue("--gsi-text")).toBe("#1F1F1F");
    expect(el.style.getPropertyValue("--gsi-fill-dark")).toBe("#131314");
    expect(el.style.getPropertyValue("--gsi-stroke-dark")).toBe("#8E918F");
    expect(el.style.getPropertyValue("--gsi-text-dark")).toBe("#E3E3E3");
  });

  it("uses colour-hinted classes so tailwind-merge replaces the primitive's own", () => {
    render(<GoogleSignInButton />);
    const cls = screen.getByRole("button", { name: "Sign in with Google" })
      .className;
    expect(cls).toContain("bg-[color:var(--gsi-fill)]");
    expect(cls).toContain("dark:bg-[color:var(--gsi-fill-dark)]");
    // The outline variant's own fill/hover must have been merged away.
    expect(cls).not.toMatch(/(^|\s)bg-background(\s|$)/);
    expect(cls).not.toContain("hover:bg-accent");
  });
});

describe("GOOGLE_BUTTON contrast", () => {
  for (const scheme of ["light", "dark"] as const) {
    const c = GOOGLE_BUTTON[scheme];
    it(`${scheme}: label clears 7:1 on the fill and on hover/pressed fills`, () => {
      expect(contrastRatio(c.text, c.fill)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(c.text, c.hover)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(c.text, c.pressed)).toBeGreaterThanOrEqual(7);
    });
    it(`${scheme}: the stroke clears 3:1 on the fill`, () => {
      expect(contrastRatio(c.stroke, c.fill)).toBeGreaterThanOrEqual(3);
    });
  }
});
