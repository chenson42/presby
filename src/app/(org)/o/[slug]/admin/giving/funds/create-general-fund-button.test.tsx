// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const createGeneralFundAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ createGeneralFundAction: (...a: unknown[]) => createGeneralFundAction(...a) }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { CreateGeneralFundButton } from "./create-general-fund-button";

afterEach(() => {
  cleanup();
  for (const fn of [createGeneralFundAction, refresh, toastSuccess, toastError]) fn.mockReset();
});

describe("CreateGeneralFundButton (the funds empty state)", () => {
  it("creates the General Fund in one tap and refreshes", async () => {
    createGeneralFundAction.mockResolvedValue({ ok: true, data: { fundId: "f1" } });
    render(<CreateGeneralFundButton slug="alder-creek" />);
    fireEvent.click(screen.getByRole("button", { name: "Create General Fund" }));
    await waitFor(() => expect(createGeneralFundAction).toHaveBeenCalledWith("alder-creek"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("General Fund added."));
    expect(refresh).toHaveBeenCalled();
  });

  it("a refusal (e.g. the name is taken) toasts the server's reason", async () => {
    createGeneralFundAction.mockResolvedValue({ ok: false, error: "A fund with that name already exists (a retired fund keeps its name)." });
    render(<CreateGeneralFundButton slug="s" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/already exists/)));
  });
});
