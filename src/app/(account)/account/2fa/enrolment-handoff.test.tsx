// @vitest-environment jsdom
/**
 * EnrolmentHandoff — the client holder that keeps the recovery codes on screen
 * (F166, DECISION-292).
 *
 * Why it exists: finishing enrolment writes the session cookie (the session is
 * marked verified), and in Next 16 any cookie write in a server action
 * re-renders the current route. The page used to swap TotpEnrollForm for a plain
 * <div> at that moment, which unmounted the form and its "save these now" panel.
 * The holder sits at the root of every branch of the page, so its identity - and
 * its state - survives the re-render. H3 pins that at the React level; only the
 * running-server specs (e2e/hydration/totp-enrol-handoff.spec.ts, both lanes)
 * prove the framework does the same.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EnrolmentHandoff, useRecoveryCodesHandoff } from "./enrolment-handoff";

afterEach(cleanup);

const CODES = Array.from({ length: 10 }, (_, i) => `AAAA-${String(1000 + i)}`);

function Trigger({ sessionVerified = true }: { sessionVerified?: boolean }) {
  const present = useRecoveryCodesHandoff();
  return (
    <button type="button" onClick={() => present({ codes: CODES, sessionVerified })}>
      finish
    </button>
  );
}

const codesShown = () => Array.from(document.querySelectorAll("ul.font-mono li")).map((li) => li.textContent);

describe("EnrolmentHandoff", () => {
  it("H1: present() shows the heading, the body, the ten codes and a Continue whose href is the server's callbackUrl", () => {
    render(
      <EnrolmentHandoff callbackUrl="/o/example-church">
        <Trigger />
      </EnrolmentHandoff>,
    );
    fireEvent.click(screen.getByRole("button", { name: "finish" }));
    expect(screen.getByRole("heading", { level: 1, name: "Two-factor authentication enabled" })).toBeTruthy();
    expect(
      screen.getByText(
        "Your authenticator app is now linked. Save these recovery codes now. They are shown only once: if you reload or leave this page, we cannot show them again.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Recovery codes — save these now" })).toBeTruthy();
    expect(screen.getByText("Each code lets you sign in once if you lose your authenticator.")).toBeTruthy();
    expect(codesShown()).toEqual(CODES);
    const cont = screen.getByRole("link", { name: "Continue" });
    expect(cont.getAttribute("href")).toBe("/o/example-church");
    expect(cont.className).toContain("min-h-11");
    expect(cont.className).toContain("w-full");
  });

  it("H2: after present() the children are not rendered (the form gives way to the panel)", () => {
    render(
      <EnrolmentHandoff callbackUrl="/launch">
        <Trigger />
        <p>the enrol form</p>
      </EnrolmentHandoff>,
    );
    expect(screen.getByText("the enrol form")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "finish" }));
    expect(screen.queryByText("the enrol form")).toBeNull();
  });

  it("H3: the panel survives the page re-render that swaps the children for the management view — regression for F166 vanishing panel", () => {
    const { rerender } = render(
      <EnrolmentHandoff callbackUrl="/launch">
        <Trigger />
      </EnrolmentHandoff>,
    );
    fireEvent.click(screen.getByRole("button", { name: "finish" }));
    expect(codesShown()).toEqual(CODES);

    // What the server sends back after completeEnrollment: the same root, new children.
    rerender(
      <EnrolmentHandoff callbackUrl="/launch">
        <div>
          <h1>Two-factor authentication</h1>
          <p>You enrolled on 2026-10-26.</p>
        </div>
      </EnrolmentHandoff>,
    );
    expect(codesShown()).toEqual(CODES);
    expect(screen.queryByText(/you enrolled on/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Continue" })).toBeTruthy();
  });

  it("H4: C5 shows only when the session could not be marked verified", () => {
    const { unmount } = render(
      <EnrolmentHandoff callbackUrl="/launch">
        <Trigger sessionVerified={false} />
      </EnrolmentHandoff>,
    );
    fireEvent.click(screen.getByRole("button", { name: "finish" }));
    expect(screen.getByText("You may be asked for a code from your app once more before you reach your destination.")).toBeTruthy();
    unmount();

    render(
      <EnrolmentHandoff callbackUrl="/launch">
        <Trigger sessionVerified />
      </EnrolmentHandoff>,
    );
    fireEvent.click(screen.getByRole("button", { name: "finish" }));
    expect(screen.queryByText(/asked for a code from your app once more/i)).toBeNull();
  });

  it("H5: the heading takes focus so a keyboard or screen-reader user is not left on a removed form", async () => {
    render(
      <EnrolmentHandoff callbackUrl="/launch">
        <Trigger />
      </EnrolmentHandoff>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "finish" }));
    });
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });

  it("H6: the hook outside the holder throws a clear error", () => {
    function Lonely() {
      useRecoveryCodesHandoff();
      return null;
    }
    const spy = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Lonely />)).toThrow(/EnrolmentHandoff/);
    } finally {
      console.error = spy;
    }
  });

  it("H7: the file never reads the query string, the location or the session machinery (the callbackUrl is the server's, as a prop)", () => {
    const src = readFileSync(resolve(__dirname, "enrolment-handoff.tsx"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const banned of ["useSearchParams", "location.search", "window.location", "@/auth", "two-factor-grant", "unstable_update"]) {
      expect(src, banned).not.toContain(banned);
    }
  });
});
