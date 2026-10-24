// @vitest-environment jsdom
/**
 * Flow 7: the six Session states and their honest copy (DECISION-205). Exact
 * strings: the `no_sign_in` swap-me sentence is the one Increment 2b replaces.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SessionStateBanner, NO_SIGN_IN_INVITE_LINE } from "./session-state-banner";

afterEach(cleanup);

type State = Parameters<typeof SessionStateBanner>[0]["state"];

function state(over: Partial<State> & { kind: State["kind"] }): State {
  return {
    recorded: 0,
    startingLater: 0,
    nextStart: null,
    viewer: { canApprove: false, canManageOfficers: false },
    ...over,
  };
}

function text() {
  return screen.getByTestId("session-state-banner").textContent;
}

describe("SessionStateBanner", () => {
  it("ready renders nothing", () => {
    const { container } = render(
      <SessionStateBanner slug="alder-creek" state={state({ kind: "ready" })} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("no_session", () => {
    render(<SessionStateBanner slug="alder-creek" state={state({ kind: "no_session" })} />);
    expect(text()).toBe(
      "No Session to approveThis organization doesn't have a Session. Receiving members is a Session act, so member roll actions aren't offered here. Participants can still be recorded.",
    );
  });

  it("empty, with officers.manage: links to Officers", () => {
    render(
      <SessionStateBanner
        slug="alder-creek"
        state={state({ kind: "empty", viewer: { canApprove: false, canManageOfficers: true } })}
      />,
    );
    expect(text()).toContain("Your Session roster is empty");
    expect(text()).toContain(
      "Record your ruling elders, installed pastors and associate pastors under Officers.",
    );
    expect(
      screen.getByRole("link", { name: "Open Officers" }).getAttribute("href"),
    ).toBe("/o/alder-creek/admin/officers");
  });

  it("empty, without officers.manage: the Ask an administrator variant, no link", () => {
    render(<SessionStateBanner slug="alder-creek" state={state({ kind: "empty" })} />);
    expect(text()).toContain(
      "Ask an administrator to record the members of the Session under Officers.",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("no_sign_in: plural, singular, and no future-start clause", () => {
    const { unmount } = render(
      <SessionStateBanner slug="s" state={state({ kind: "no_sign_in", recorded: 3 })} />,
    );
    expect(text()).toContain(
      "3 members of the Session are recorded, but none has a PresbyPortal account yet, so no one can approve.",
    );
    expect(text()).toContain(NO_SIGN_IN_INVITE_LINE);
    expect(text()).not.toContain("The first term begins");
    unmount();

    const again = render(
      <SessionStateBanner slug="s" state={state({ kind: "no_sign_in", recorded: 1 })} />,
    );
    expect(text()).toContain("1 member of the Session is recorded");
    again.unmount();

    render(
      <SessionStateBanner
        slug="s"
        state={state({ kind: "no_sign_in", recorded: 2, startingLater: 2, nextStart: "2027-01-10" })}
      />,
    );
    expect(text()).toContain("2 members of the Session are recorded, but none has");
    expect(text()).not.toMatch(/term begins|terms haven't/);
  });

  describe("terms_not_started", () => {
    const P2 = "To approve, a member of the Session also needs a PresbyPortal account.";

    it("plural with a date, whole text", () => {
      render(
        <SessionStateBanner
          slug="s"
          state={state({ kind: "terms_not_started", startingLater: 3, nextStart: "2027-01-10" })}
        />,
      );
      const t = text();
      expect(t).toMatch(
        /^No one can approve yet3 members of the Session are recorded, but their terms haven't begun\. The first term begins .*2027.*, and no member of the Session can approve before then\./,
      );
      expect(t).toContain(P2);
      expect(t.endsWith(P2)).toBe(true);
    });

    it("singular with a date", () => {
      render(
        <SessionStateBanner
          slug="s"
          state={state({ kind: "terms_not_started", startingLater: 1, nextStart: "2027-01-10" })}
        />,
      );
      expect(text()).toMatch(
        /1 member of the Session is recorded, but their term hasn't begun\. The term begins .*2027.*, and no member of the Session can approve before then\./,
      );
      expect(text()).toContain(P2);
    });

    it("plural and singular with no date", () => {
      const { unmount } = render(
        <SessionStateBanner
          slug="s"
          state={state({ kind: "terms_not_started", startingLater: 2, nextStart: null })}
        />,
      );
      expect(text()).toContain(
        "2 members of the Session are recorded, but their terms haven't begun, so no member of the Session can approve yet.",
      );
      expect(text()).toContain(P2);
      unmount();
      render(
        <SessionStateBanner
          slug="s"
          state={state({ kind: "terms_not_started", startingLater: 1, nextStart: null })}
        />,
      );
      expect(text()).toContain(
        "1 member of the Session is recorded, but their term hasn't begun, so no member of the Session can approve yet.",
      );
      expect(text()).toContain(P2);
    });

    it("claims nothing about accounts and offers no action", () => {
      render(
        <SessionStateBanner
          slug="s"
          state={state({ kind: "terms_not_started", startingLater: 2, nextStart: "2027-01-10" })}
        />,
      );
      expect(text()).not.toContain("none has a PresbyPortal account");
      expect(text()).not.toContain(NO_SIGN_IN_INVITE_LINE);
      expect(text()).not.toMatch(/support ticket/i);
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  it("no_sign_in says inviting isn't available yet (the constant 2b replaces)", () => {
    expect(NO_SIGN_IN_INVITE_LINE).toBe(
      "Inviting someone to sign in isn't available here yet. Send us a support ticket and we'll help get them set up.",
    );
  });

  it("no_permission", () => {
    render(<SessionStateBanner slug="s" state={state({ kind: "no_permission", recorded: 2 })} />);
    expect(text()).toBe(
      "No one can approve yetMembers of the Session are recorded and have accounts, but none of them has permission to approve roll actions. This usually means the Session member role was changed. Check Roles, or send us a support ticket.",
    );
  });

  it("is a status region, never an alert (it is not an error)", () => {
    render(<SessionStateBanner slug="s" state={state({ kind: "no_session" })} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
