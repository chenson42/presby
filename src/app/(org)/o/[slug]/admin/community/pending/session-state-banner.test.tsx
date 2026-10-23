// @vitest-environment jsdom
/**
 * Flow 7: the five Session states and their honest copy (DECISION-205). Exact
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

  it("no_sign_in: plural, singular, and the future-start sentence", () => {
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
        state={state({ kind: "no_sign_in", recorded: 0, startingLater: 2, nextStart: "2027-01-10" })}
      />,
    );
    expect(text()).toContain("2 members of the Session are recorded");
    expect(text()).toContain("The first term begins");
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
