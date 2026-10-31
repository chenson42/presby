// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STALE_MESSAGE } from "@/lib/careers/messages";

const mockSetStatus = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ setPostingStatusAction: (...a: unknown[]) => mockSetStatus(...a) }));
const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

import { StatusControls } from "./status-controls";

afterEach(() => {
  cleanup();
  for (const mock of [mockSetStatus, mockRefresh, toastSuccess, toastError]) mock.mockReset();
});

const base = {
  slug: "alder-creek",
  postingId: "id-1",
  title: "Custodian",
  version: 4,
  status: "draft" as const,
  neverPublished: false,
  closingDatePassed: false,
};

async function confirm(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("StatusControls - T21", () => {
  it("every button is disabled before hydration", () => {
    const html = renderToString(<StatusControls {...base} />);
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(2);
  });

  it("a draft offers Publish and Discard; a published row offers Close; a closed row offers Reopen", () => {
    const { rerender } = render(<StatusControls {...base} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Publish", "Discard this draft"]);
    rerender(<StatusControls {...base} status="published" />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Close this opening"]);
    rerender(<StatusControls {...base} status="closed" />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Reopen"]);
  });

  it("a 'Never published' (discarded) row offers no Reopen (orchestrator ruling)", () => {
    render(<StatusControls {...base} status="closed" neverPublished />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("Publish: the dialog names the posting, and confirming passes { id, version, to } and toasts the RETURNED status", async () => {
    mockSetStatus.mockResolvedValue({ ok: true, data: { status: "published", version: 5 } });
    render(<StatusControls {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(screen.getByText('Publish "Custodian"?')).toBeTruthy();
    expect(screen.getByText("Anyone on the internet will be able to read this opening on your website. Changes you save later appear right away.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep as draft" })).toBeTruthy();
    await confirm("Yes, publish");
    expect(mockSetStatus).toHaveBeenCalledWith("alder-creek", { id: "id-1", version: 4, to: "published" });
    expect(toastSuccess).toHaveBeenCalledWith("Published.");
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("Close, Reopen and Discard use their own dialog copy, edge and toast", async () => {
    mockSetStatus.mockResolvedValue({ ok: true, data: { status: "closed", version: 5 } });
    render(<StatusControls {...base} status="published" />);
    fireEvent.click(screen.getByRole("button", { name: "Close this opening" }));
    expect(screen.getByText('Close "Custodian"?')).toBeTruthy();
    expect(screen.getByText("It will come off your website and out of the list of openings. You can reopen it later.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep it open" })).toBeTruthy();
    await confirm("Yes, close it");
    expect(mockSetStatus).toHaveBeenLastCalledWith("alder-creek", { id: "id-1", version: 4, to: "closed" });
    expect(toastSuccess).toHaveBeenLastCalledWith("Closed.");
    cleanup();

    mockSetStatus.mockResolvedValue({ ok: true, data: { status: "published", version: 6 } });
    render(<StatusControls {...base} status="closed" />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(screen.getByText('Reopen "Custodian"?')).toBeTruthy();
    expect(screen.getByText("It returns to your website right away, at the top of the list.")).toBeTruthy();
    await confirm("Yes, reopen it");
    expect(mockSetStatus).toHaveBeenLastCalledWith("alder-creek", { id: "id-1", version: 4, to: "published" });
    expect(toastSuccess).toHaveBeenLastCalledWith("Reopened.");
    cleanup();

    mockSetStatus.mockResolvedValue({ ok: true, data: { status: "closed", version: 7 } });
    render(<StatusControls {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard this draft" }));
    expect(screen.getByText("Discard this draft?", { selector: "h2" })).toBeTruthy();
    expect(screen.getByText("It moves to Closed and never appears on your website.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep the draft" })).toBeTruthy();
    await confirm("Yes, discard it");
    expect(mockSetStatus).toHaveBeenLastCalledWith("alder-creek", { id: "id-1", version: 4, to: "closed" });
    expect(toastSuccess).toHaveBeenLastCalledWith("Draft discarded.");
  });

  it("reopen with a passed closing date is disabled and says what to do instead", () => {
    render(<StatusControls {...base} status="closed" closingDatePassed />);
    const button = screen.getByRole("button", { name: "Reopen" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Its closing date has passed. Change the closing date, save, then reopen.")).toBeTruthy();
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("a refusal toasts the returned error text and writes nothing else", async () => {
    mockSetStatus.mockResolvedValue({ ok: false, error: "The closing date has already passed. Change it before publishing." });
    render(<StatusControls {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await confirm("Yes, publish");
    expect(toastError).toHaveBeenCalledWith("The closing date has already passed. Change it before publishing.");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("a stale version shows the stale message with a Reload action", async () => {
    mockSetStatus.mockResolvedValue({ ok: false, error: STALE_MESSAGE });
    render(<StatusControls {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await confirm("Yes, publish");
    expect(toastError).toHaveBeenCalledWith(STALE_MESSAGE, expect.objectContaining({ action: expect.objectContaining({ label: "Reload" }) }));
  });

  it("Publish, Reopen and Close save unsaved edits first (prepare) and change the version it returns; Discard does not", async () => {
    const prepare = vi.fn().mockResolvedValue(9);
    mockSetStatus.mockResolvedValue({ ok: true, data: { status: "published", version: 10 } });
    render(<StatusControls {...base} prepare={prepare} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await confirm("Yes, publish");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(mockSetStatus).toHaveBeenCalledWith("alder-creek", { id: "id-1", version: 9, to: "published" });
    cleanup();

    prepare.mockClear();
    mockSetStatus.mockClear();
    mockSetStatus.mockResolvedValue({ ok: true, data: { status: "closed", version: 11 } });
    render(<StatusControls {...base} status="published" prepare={prepare} />);
    fireEvent.click(screen.getByRole("button", { name: "Close this opening" }));
    await confirm("Yes, close it");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(mockSetStatus).toHaveBeenCalledWith("alder-creek", { id: "id-1", version: 9, to: "closed" });
    cleanup();

    prepare.mockClear();
    mockSetStatus.mockClear();
    render(<StatusControls {...base} prepare={prepare} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard this draft" }));
    await confirm("Yes, discard it");
    expect(prepare).not.toHaveBeenCalled();
    expect(mockSetStatus).toHaveBeenCalledWith("alder-creek", { id: "id-1", version: 4, to: "closed" });
  });

  it("when the save-first step fails, nothing is published", async () => {
    const prepare = vi.fn().mockResolvedValue(null);
    render(<StatusControls {...base} prepare={prepare} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await confirm("Yes, publish");
    expect(mockSetStatus).not.toHaveBeenCalled();
  });
});
