// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  INVITATION_WARNING_COPY,
  acceptanceSentence,
} from "@/lib/onboarding/invitation-copy";
import { InvitationSentNotice } from "./invitation-sent-notice";

afterEach(cleanup);

// Imported, not copied: a wording change in the shared module is the single edit.
const WARNING = INVITATION_WARNING_COPY.address_on_signed_in_person;
const OK = { ok: true as const, expiresAt: "2026-11-01T00:00:00.000Z", delivery: "sent" as const };

describe("InvitationSentNotice - warnings", () => {
  it("renders each warning as a Note inside the status region (the invitation WAS sent, so it is not an alert)", () => {
    render(
      <InvitationSentNotice
        purpose="founding_administrator"
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
        purpose="treasurer"
        result={{ ok: true, expiresAt: "2026-11-01T00:00:00.000Z", delivery: "queued" }}
      />,
    );
    expect(screen.queryByTestId("invitation-warning")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Email delivery is delayed");
  });

  it("a refusal is still an alert and shows no warning", () => {
    render(<InvitationSentNotice purpose="founding_administrator" result={{ ok: false, error: "Nope." }} />);
    expect(screen.getByRole("alert").textContent).toContain("Not sent. Nope.");
    expect(screen.queryByTestId("invitation-warning")).toBeNull();
  });
});

describe("InvitationSentNotice - who must accept (the copy table)", () => {
  const text = () => (screen.getByRole("status").textContent ?? "").replace(/\s+/g, " ");

  it("founding administrator, name known", () => {
    render(
      <InvitationSentNotice
        purpose="founding_administrator"
        address="clerk@example.invalid"
        result={{ ...OK, inviteeDisplayName: "Marisol Quenby" }}
      />,
    );
    expect(text()).toContain(
      "The founding administrator designation takes effect when Marisol Quenby accepts it from the email. Until then nobody holds this role.",
    );
    expect(text()).not.toContain("Nobody holds this role until it is accepted");
  });

  it("treasurer, name known (first name only)", () => {
    render(
      <InvitationSentNotice
        purpose="treasurer"
        address="treasurer@example.invalid"
        result={{ ...OK, inviteeDisplayName: "Perpetua" }}
      />,
    );
    expect(text()).toContain(
      "The treasurer designation takes effect when Perpetua accepts it from the email. Until then nobody holds this access.",
    );
  });

  it("no name, address known: the person at the address", () => {
    render(<InvitationSentNotice purpose="treasurer" address="treasurer@example.invalid" result={OK} />);
    expect(text()).toContain(
      "takes effect when the person at treasurer@example.invalid accepts it from the email. Until then nobody holds this access.",
    );
  });

  it("no name, no address: the invitee", () => {
    render(<InvitationSentNotice purpose="founding_administrator" result={OK} />);
    expect(text()).toContain(
      "takes effect when the invitee accepts it from the email. Until then nobody holds this role.",
    );
  });

  it("uses the shared builder verbatim and keeps the expiry sentence before it", () => {
    render(
      <InvitationSentNotice
        purpose="founding_administrator"
        address="clerk@example.invalid"
        result={{ ...OK, inviteeDisplayName: "Marisol Quenby" }}
      />,
    );
    const body = text();
    const sentence = acceptanceSentence({
      purpose: "founding_administrator",
      name: "Marisol Quenby",
      address: "clerk@example.invalid",
    });
    expect(body).toContain(sentence);
    expect(body.indexOf("It expires on")).toBeLessThan(body.indexOf(sentence));
    expect(body.startsWith("Invitation sent to clerk@example.invalid.")).toBe(true);
  });

  it("the queued variant leads with the delay and still names who must accept", () => {
    render(
      <InvitationSentNotice
        purpose="founding_administrator"
        address="clerk@example.invalid"
        result={{ ...OK, delivery: "queued", inviteeDisplayName: "Marisol Quenby" }}
      />,
    );
    expect(text()).toContain("Invitation created for clerk@example.invalid. Email delivery is delayed; we'll keep trying.");
    expect(text()).toContain("takes effect when Marisol Quenby accepts it from the email");
  });

  it("wraps a long name instead of overflowing (break-words)", () => {
    render(
      <InvitationSentNotice
        purpose="founding_administrator"
        result={{ ...OK, inviteeDisplayName: "W".repeat(100) }}
      />,
    );
    expect(screen.getByRole("status").className).toContain("break-words");
  });

  it("a revoke result (no expiry) shows only Done, with no acceptance sentence", () => {
    render(<InvitationSentNotice purpose="treasurer" result={{ ok: true, invitationId: "inv-1" }} />);
    expect(screen.getByRole("status").textContent).toBe("Done.");
  });
});
