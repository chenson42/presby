// @vitest-environment jsdom
/**
 * Flow 7: the six Session states and their honest copy (DECISION-205), as
 * reworded by Community Increment 2b (Copy group F): "connected a sign-in", the
 * `no_sign_in` hand-off (rows for a viewer with both keys, one sentence for
 * everyone else), and no hand-off in `terms_not_started` (284b).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SessionStateBanner, type SessionHandOff } from "./session-state-banner";
import { SESSION_BANNER_COPY } from "@/lib/onboarding/sign-in-copy";

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
      "3 members of the Session are recorded, but none has connected a sign-in yet, so no one can approve.",
    );
    expect(text()).not.toContain("PresbyPortal account");
    expect(text()).not.toContain("isn't available here yet");
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

  describe("no_sign_in hand-off (group F)", () => {
    const NO_SIGN_IN = state({ kind: "no_sign_in", recorded: 3 });
    const rowsOf = (...rows: Array<Partial<Extract<SessionHandOff, { kind: "rows" }>["rows"][number]>>) =>
      rows.map((r, i) => ({
        personId: `p-${i}`,
        name: `Person ${i}`,
        state: "not_invited" as const,
        sentAt: null,
        action: "invite" as const,
        ...r,
      }));

    it("any other viewer (and the default) gets one sentence: no names, no link", () => {
      const { unmount } = render(<SessionStateBanner slug="s" state={NO_SIGN_IN} />);
      expect(text()).toContain(SESSION_BANNER_COPY.otherViewers);
      expect(text()).toContain("Ask an administrator to invite your Session members to sign in.");
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByTestId("session-sign-in-rows")).toBeNull();
      unmount();
      render(<SessionStateBanner slug="s" state={NO_SIGN_IN} handOff={{ kind: "other" }} />);
      expect(text()).toContain(SESSION_BANNER_COPY.otherViewers);
    });

    it("a viewer with both keys, toggle on: the sentence, one row per seat with its state and link", () => {
      render(
        <SessionStateBanner
          slug="alder-creek"
          state={NO_SIGN_IN}
          handOff={{
            kind: "rows",
            connectEnabled: true,
            rows: rowsOf(
              { name: "Nora Ashgrove", state: "no_email", action: "open" },
              { name: "Bram Okafor", state: "not_invited", action: "invite" },
              { name: "Iris Valdez", state: "expired", action: "open" },
            ),
          }}
        />,
      );
      expect(text()).toContain(SESSION_BANNER_COPY.handOff);
      expect(text()).not.toContain(SESSION_BANNER_COPY.otherViewers);
      const rows = screen.getAllByTestId("session-sign-in-row");
      expect(rows).toHaveLength(3);
      expect(rows[0].textContent).toContain("Nora Ashgrove");
      expect(rows[0].textContent).toContain("No email on file");
      expect(rows[1].textContent).toContain("Not invited yet");
      expect(rows[2].textContent).toContain("Invitation expired");
      const invite = screen.getByRole("link", { name: /invite\s*bram\s*okafor/i });
      // The accessible name carries whose row it is (the Edit button's precedent).
      expect(invite.textContent).toBe("Invite Bram Okafor");
      expect(invite.getAttribute("href")).toBe("/o/alder-creek/admin/community/p-1/edit#sign-in");
      expect(invite.textContent).toContain("Invite");
      expect(screen.getByRole("link", { name: /open\s*nora\s*ashgrove/i }).getAttribute("href")).toBe(
        "/o/alder-creek/admin/community/p-0/edit#sign-in",
      );
      // Nothing is out: no count line.
      expect(text()).not.toMatch(/Invitations sent to/);
    });

    it("toggle off: the rows and counts without the first sentence", () => {
      render(
        <SessionStateBanner
          slug="s"
          state={NO_SIGN_IN}
          handOff={{ kind: "rows", connectEnabled: false, rows: rowsOf({ state: "sent", sentAt: new Date("2026-10-20T12:00:00Z"), action: "open" }) }}
        />,
      );
      expect(text()).not.toContain(SESSION_BANNER_COPY.handOff);
      expect(screen.getAllByTestId("session-sign-in-row")).toHaveLength(1);
      expect(text()).toContain("Invitations sent to 1 of the 3 members of the Session. Waiting for them to accept.");
    });

    it("counts open invitations (sent or bounced), not expired ones, against the recorded members", () => {
      render(
        <SessionStateBanner
          slug="s"
          state={NO_SIGN_IN}
          handOff={{
            kind: "rows",
            connectEnabled: true,
            rows: rowsOf(
              { state: "sent", sentAt: new Date("2026-10-20T12:00:00Z"), action: "open" },
              { state: "bounced", sentAt: new Date("2026-10-20T12:00:00Z"), action: "open" },
              { state: "expired", sentAt: new Date("2026-10-01T12:00:00Z"), action: "open" },
            ),
          }}
        />,
      );
      expect(text()).toContain("Invitations sent to 2 of the 3 members of the Session. Waiting for them to accept.");
      const labels = screen.getAllByTestId("session-sign-in-row").map((r) => r.textContent);
      expect(labels[1]).toContain("Email bounced");
    });

    it("a blocked seat reads 'Invitation couldn't be completed' and links to Open (amendment 3)", () => {
      render(
        <SessionStateBanner
          slug="s"
          state={NO_SIGN_IN}
          handOff={{ kind: "rows", connectEnabled: true, rows: rowsOf({ name: "Nora Ashgrove", state: "blocked", action: "open" }) }}
        />,
      );
      expect(screen.getByTestId("session-sign-in-row").textContent).toContain("Invitation couldn't be completed");
      expect(screen.getByRole("link", { name: /open\s*nora\s*ashgrove/i })).toBeTruthy();
    });

    it("the row link is a 44px target and the sent date is a timezone-safe <time>", () => {
      render(
        <SessionStateBanner
          slug="s"
          state={NO_SIGN_IN}
          handOff={{ kind: "rows", connectEnabled: true, rows: rowsOf({ state: "sent", sentAt: new Date("2026-10-20T12:00:00Z"), action: "open" }) }}
        />,
      );
      expect(screen.getByRole("link").className).toContain("min-h-11");
      expect(screen.getByTestId("session-sign-in-row").querySelector("time")).not.toBeNull();
      expect(screen.getByTestId("session-sign-in-row").textContent).toMatch(/^Person 0Invitation sent /);
    });

    it("the hand-off never appears in terms_not_started (284b)", () => {
      render(
        <SessionStateBanner
          slug="s"
          state={state({ kind: "terms_not_started", startingLater: 2, nextStart: "2027-01-10" })}
          handOff={{ kind: "rows", connectEnabled: true, rows: rowsOf({}) }}
        />,
      );
      expect(screen.queryByTestId("session-sign-in-rows")).toBeNull();
      expect(text()).not.toContain(SESSION_BANNER_COPY.handOff);
      expect(text()).not.toContain(SESSION_BANNER_COPY.otherViewers);
    });
  });

  describe("terms_not_started", () => {
    const P2 = "To approve, a member of the Session also needs to have connected a sign-in.";

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
      expect(text()).not.toContain("none has connected a sign-in");
      expect(text()).not.toMatch(/support ticket/i);
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  it("no_permission", () => {
    render(<SessionStateBanner slug="s" state={state({ kind: "no_permission", recorded: 2 })} />);
    expect(text()).toBe(
      "No one can approve yetSome members of the Session have connected a sign-in, but none of them has permission to approve roll actions. This usually means the Session member role was changed. Ask an administrator to check the Session member role, or send us a support ticket.",
    );
  });

  it("is a status region, never an alert (it is not an error)", () => {
    render(<SessionStateBanner slug="s" state={state({ kind: "no_session" })} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
