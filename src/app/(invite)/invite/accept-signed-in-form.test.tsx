// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AcceptFormState } from "../actions";

const mockAccept = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({
  acceptSignedInAction: (prev: unknown, fd: FormData) => mockAccept(prev, fd),
}));

import { AcceptSignedInForm } from "./accept-signed-in-form";

const TOKEN = "A".repeat(43);

afterEach(() => {
  cleanup();
  mockAccept.mockReset();
});

describe("AcceptSignedInForm", () => {
  it("submits only the token (identity comes from the session, never the form)", async () => {
    mockAccept.mockResolvedValue({ status: "idle" } satisfies AcceptFormState);
    render(<AcceptSignedInForm token={TOKEN} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
    });
    const fd = mockAccept.mock.calls[0][1] as FormData;
    expect([...fd.keys()]).toEqual(["token"]);
    expect(fd.get("token")).toBe(TOKEN);
  });

  it("shows a refusal inline in a role=alert that takes focus", async () => {
    mockAccept.mockResolvedValue({
      status: "error",
      code: "blocked",
      message: "This invitation can no longer be accepted because someone else now holds this access. Contact the person who invited you.",
    } satisfies AcceptFormState);
    render(<AcceptSignedInForm token={TOKEN} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/someone else now holds this access/i);
    expect(document.activeElement).toBe(alert);
  });

  it("renders no alert before anything is submitted", () => {
    render(<AcceptSignedInForm token={TOKEN} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("AcceptSignedInForm — finished invitations", () => {
  it("a blocked acceptance removes the Accept button (the token is spent)", async () => {
    mockAccept.mockResolvedValue({ status: "error", code: "blocked", message: "Contact the person who invited you." } satisfies AcceptFormState);
    render(<AcceptSignedInForm token={TOKEN} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
    });
    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/contact the person/i);
  });

  it("a transient error (database blip) keeps the button so the visitor can retry", async () => {
    mockAccept.mockResolvedValue({ status: "error", code: "db_error", message: "Your link is still good." } satisfies AcceptFormState);
    render(<AcceptSignedInForm token={TOKEN} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
    });
    expect(screen.getByRole("button", { name: /accept invitation/i })).toBeTruthy();
  });
});
