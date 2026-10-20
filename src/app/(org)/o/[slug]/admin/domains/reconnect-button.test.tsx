// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const reconnectClaimAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ reconnectClaimAction: (...a: unknown[]) => reconnectClaimAction(...a) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { ReconnectButton } from "./reconnect-button";

afterEach(() => {
  cleanup();
  reconnectClaimAction.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("ReconnectButton", () => {
  it("reconnects the claim and confirms", async () => {
    reconnectClaimAction.mockResolvedValue({ ok: true });
    render(<ReconnectButton slug="alder-creek" claimName="church-one.invalid" />);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(reconnectClaimAction).toHaveBeenCalledWith("alder-creek", "church-one.invalid"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reconnected. We're checking your records again."));
  });

  it("when the ownership record is missing it says to add it back (the server's words)", async () => {
    reconnectClaimAction.mockResolvedValue({ ok: false, code: "proof_missing", error: "We can't find your ownership record yet. Add it back at your DNS provider, then try again." });
    render(<ReconnectButton slug="a" claimName="b.invalid" />);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("We can't find your ownership record yet. Add it back at your DNS provider, then try again."));
  });

  it("a thrown action is a human toast", async () => {
    reconnectClaimAction.mockRejectedValue(new Error("boom"));
    render(<ReconnectButton slug="a" claimName="b.invalid" />);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("We couldn't reconnect it right now. Try again in a few minutes."));
  });
});
