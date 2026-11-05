// @vitest-environment jsdom
/** Accept / Decline / "I can serve after all" (Copy G6): which buttons per status, the reason choice, one call per tap. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const respond = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ respondToRequestAction: (...a: unknown[]) => respond(...a) }));

import { MEMBER_COPY } from "@/lib/worship/copy";
import { RequestActions } from "./request-actions";

const ID = "55555555-5555-4555-8555-555555555555";
const view = (status: "requested" | "confirmed" | "declined") =>
  render(<RequestActions slug="alder" assignmentId={ID} status={status} positionName="Vocals" whenLabel="Sunday, November 16 at 10:00 AM" idPrefix="t" />);

beforeEach(() => {
  for (const m of [refresh, respond, toast.success, toast.error]) m.mockReset();
});
afterEach(cleanup);

describe("RequestActions", () => {
  it("a waiting request offers Accept and Decline", () => {
    view("requested");
    expect(screen.getByTestId("accept").textContent).toBe(MEMBER_COPY.home.accept);
    expect(screen.getByTestId("decline").textContent).toBe(MEMBER_COPY.home.decline);
    expect(screen.queryByTestId("serve-after-all")).toBeNull();
  });

  it("a confirmed request offers only Decline", () => {
    view("confirmed");
    expect(screen.queryByTestId("accept")).toBeNull();
    expect(screen.getByTestId("decline")).toBeTruthy();
  });

  it("a declined request offers only 'I can serve after all'", () => {
    view("declined");
    expect(screen.queryByTestId("decline")).toBeNull();
    expect(screen.getByTestId("serve-after-all").textContent).toBe(MEMBER_COPY.home.serveAfterAll);
  });

  it("Accept sends the answer for this assignment only and toasts the confirmed sentence", async () => {
    respond.mockResolvedValue({ ok: true, data: { changed: true } });
    view("requested");
    fireEvent.click(screen.getByTestId("accept"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(MEMBER_COPY.request.toastConfirmed("Vocals", "Sunday, November 16 at 10:00 AM")));
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith("alder", { assignmentId: ID, answer: "accepted", reason: null });
    expect(refresh).toHaveBeenCalled();
  });

  it("Decline asks for an optional closed-list reason first; the first tap writes nothing", async () => {
    respond.mockResolvedValue({ ok: true, data: { changed: true } });
    view("requested");
    fireEvent.click(screen.getByTestId("decline"));
    expect(respond).not.toHaveBeenCalled();
    const select = screen.getByLabelText(MEMBER_COPY.request.reasonLabel) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["", "Away", "Work", "Family", "Other"]);
    expect(screen.getByText(MEMBER_COPY.request.reasonHelper)).toBeTruthy();
    fireEvent.change(select, { target: { value: "family" } });
    fireEvent.click(screen.getByTestId("decline-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(MEMBER_COPY.request.toastDeclined));
    expect(respond).toHaveBeenCalledWith("alder", { assignmentId: ID, answer: "declined", reason: "family" });
  });

  it("Cancel closes the reason choice without calling anything", () => {
    view("requested");
    fireEvent.click(screen.getByTestId("decline"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(respond).not.toHaveBeenCalled();
    expect(screen.getByTestId("accept")).toBeTruthy();
  });

  it("a double tap while the call is in flight sends one request", async () => {
    let finish: (v: unknown) => void = () => {};
    respond.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    view("requested");
    const accept = screen.getByTestId("accept");
    fireEvent.click(accept);
    fireEvent.click(accept);
    expect(respond).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: { changed: true } });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("a refusal is toasted in the server's words and the page re-reads", async () => {
    respond.mockResolvedValue({ ok: false, error: "That service was cancelled." });
    view("requested");
    fireEvent.click(screen.getByTestId("accept"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That service was cancelled."));
    expect(refresh).toHaveBeenCalled();
  });

  it("buttons are 44px targets", () => {
    view("requested");
    for (const id of ["accept", "decline"]) expect(screen.getByTestId(id).className).toContain("min-h-11");
  });
});
