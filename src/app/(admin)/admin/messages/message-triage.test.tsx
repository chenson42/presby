// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const setContactMessageStatus = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ setContactMessageStatus, clearContactMessageDetails: vi.fn() }));

import { MessageTriage } from "./message-triage";

const ID = "11111111-2222-4333-8444-555555555555";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const names = () => screen.getAllByRole("button").map((b) => b.textContent);

describe("MessageTriage", () => {
  it("never offers the status the message already has", () => {
    render(<MessageTriage id={ID} status="new" cleared={false} />);
    expect(names()).toEqual(["Mark as handled", "Mark as spam"]);
    cleanup();
    render(<MessageTriage id={ID} status="handled" cleared={false} />);
    expect(names()).toEqual(["Mark as spam", "Move back to new"]);
    cleanup();
    render(<MessageTriage id={ID} status="spam" cleared={false} />);
    expect(names()).toEqual(["Mark as handled", "Move back to new"]);
  });

  it("hides 'Move back to new' once the details were cleared", () => {
    render(<MessageTriage id={ID} status="handled" cleared />);
    expect(names()).toEqual(["Mark as spam"]);
  });

  it("every button is a 44px target", () => {
    render(<MessageTriage id={ID} status="new" cleared={false} />);
    for (const b of screen.getAllByRole("button")) expect(b.className).toMatch(/min-h-11/);
  });

  it("success: calls the action, toasts the result and refreshes", async () => {
    setContactMessageStatus.mockResolvedValue({ ok: true });
    render(<MessageTriage id={ID} status="new" cleared={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as spam" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(setContactMessageStatus).toHaveBeenCalledWith(ID, "spam");
    expect(toast.success).toHaveBeenCalledWith("Marked as spam.");
  });

  it("a refusal toasts the server's sentence and does not refresh", async () => {
    setContactMessageStatus.mockResolvedValue({ ok: false, error: "Forbidden." });
    render(<MessageTriage id={ID} status="new" cleared={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as handled" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Forbidden."));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a thrown action toasts the failure sentence", async () => {
    setContactMessageStatus.mockRejectedValue(new Error("network"));
    render(<MessageTriage id={ID} status="new" cleared={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as handled" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not change the status. Try again."));
  });

  it("disables every button while one is pending", async () => {
    let release: (v: unknown) => void = () => {};
    setContactMessageStatus.mockReturnValue(new Promise((r) => (release = r)));
    render(<MessageTriage id={ID} status="new" cleared={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as handled" }));
    await waitFor(() => {
      for (const b of screen.getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
    });
    release({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
