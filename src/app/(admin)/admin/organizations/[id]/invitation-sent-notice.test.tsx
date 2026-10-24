// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InvitationSentNotice } from "./invitation-sent-notice";

afterEach(cleanup);

const WARNING =
  "That address is already on file for a person here who signs in. The invitation was sent, but it will be refused unless the invitee accepts while signed in to that person's own account.";

describe("InvitationSentNotice - warnings", () => {
  it("renders each warning as a Note inside the status region (the invitation WAS sent, so it is not an alert)", () => {
    render(
      <InvitationSentNotice
        role="role"
        address="holder@example.invalid"
        result={{
          ok: true,
          expiresAt: "2026-11-01T00:00:00.000Z",
          delivery: "sent",
          warnings: [{ code: "address_on_signed_in_person", message: WARNING }],
        }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Invitation sent to holder@example.invalid.");
    const note = screen.getByTestId("invitation-warning");
    expect(status.contains(note)).toBe(true);
    expect(note.textContent).toBe(`Note. ${WARNING}`);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders no warning paragraph when there are none (an unwarned send reads exactly as before)", () => {
    render(
      <InvitationSentNotice
        role="access"
        result={{ ok: true, expiresAt: "2026-11-01T00:00:00.000Z", delivery: "queued" }}
      />,
    );
    expect(screen.queryByTestId("invitation-warning")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Email delivery is delayed");
  });

  it("a refusal is still an alert and shows no warning", () => {
    render(<InvitationSentNotice role="role" result={{ ok: false, error: "Nope." }} />);
    expect(screen.getByRole("alert").textContent).toContain("Not sent. Nope.");
    expect(screen.queryByTestId("invitation-warning")).toBeNull();
  });
});
