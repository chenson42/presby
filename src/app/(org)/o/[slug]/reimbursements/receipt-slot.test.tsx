// @vitest-environment jsdom
/**
 * The receipt slot (docs/work-log/2026-10-25-treasury-inc1.md, Batch 2b; Copy C3
 * and C4). The upload route answers a `kind`; every sentence here is Copy, with
 * the name the person's own device gave the file. Pins: the one-file picker with
 * no `capture`, the revision handed back after every attach and detach, that a
 * refused upload names the file, that nothing is sent when the draft could not be
 * saved, and that a second pick while one is under way does nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));
const detachReceiptAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ detachReceiptAction: (...a: unknown[]) => detachReceiptAction(...a) }));

import { COPY } from "@/lib/reimbursement/copy";
import { MAX_RECEIPTS } from "@/lib/reimbursement/limits";
import { ACCEPTED_TYPES, ReceiptSlot, uploadFailureMessage, type ReceiptItem, type ReceiptSlotProps } from "./receipt-slot";

const REQ = "44444444-4444-4444-8444-444444444444";
const ATT = "55555555-5555-4555-8555-555555555555";
const ATT2 = "66666666-6666-4666-8666-666666666666";

const item = (id: string, displayName: string): ReceiptItem => ({ id, displayName, contentType: "image/jpeg", byteSize: 1234 });

const fetchMock = vi.fn();

function setup(over: Partial<ReceiptSlotProps> = {}) {
  const props: ReceiptSlotProps = {
    slug: "alder",
    requestId: REQ,
    receipts: [],
    disabled: false,
    ensureDraft: vi.fn().mockResolvedValue({ requestId: REQ, revision: 3 }),
    onChange: vi.fn(),
    onBusyChange: vi.fn(),
    ...over,
  };
  render(<ReceiptSlot {...props} />);
  return props;
}

const input = () => screen.getByTestId("receipt-input") as HTMLInputElement;
const pick = (file: File) => fireEvent.change(input(), { target: { files: [file] } });
const png = (name = "Hardware store.png", bytes = 10) => new File([new Uint8Array(bytes)], name, { type: "image/png" });
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  push.mockReset();
  detachReceiptAction.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReceiptSlot - the picker", () => {
  it("is one file input that takes photos and PDFs and has no `capture` (T3)", () => {
    setup();
    expect(input().type).toBe("file");
    expect(input().accept).toBe(ACCEPTED_TYPES);
    expect(input().accept.split(",").sort()).toEqual(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    expect(input().hasAttribute("capture")).toBe(false);
    expect(input().multiple).toBe(false);
    expect(screen.getByTestId("receipt-add").textContent).toBe(COPY.form.addReceipt);
  });

  it("lists the receipts as links to the download route, each with a Remove named for its file", () => {
    setup({ receipts: [item(ATT, "Hardware store.jpg"), item(ATT2, "Invoice.pdf")] });
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      `/o/alder/reimbursements/${REQ}/receipts/${ATT}`,
      `/o/alder/reimbursements/${REQ}/receipts/${ATT2}`,
    ]);
    expect(screen.getByRole("button", { name: "Remove Hardware store.jpg" }).textContent).toBe(COPY.receipts.remove);
    expect(screen.getByRole("button", { name: "Remove Invoice.pdf" })).toBeTruthy();
  });

  it("at the cap the picker is replaced by the 'most receipts allowed' sentence", () => {
    setup({ receipts: Array.from({ length: MAX_RECEIPTS }, (_, i) => item(`id-${i}`, `r${i}.jpg`)) });
    expect(screen.queryByTestId("receipt-add")).toBeNull();
    expect(screen.getByTestId("receipt-cap").textContent).toBe(COPY.receipts.tooMany);
  });

  it("disables the picker and every Remove while the form is busy", () => {
    setup({ receipts: [item(ATT, "a.jpg")], disabled: true });
    expect((screen.getByTestId("receipt-add") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("receipt-remove") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("ReceiptSlot - an upload", () => {
  it("saves the draft first, posts ONE file to the request's route, and reports the list and the NEW revision", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { attachmentId: ATT, displayName: "Hardware store.jpg", byteSize: 4321, contentType: "image/jpeg", revision: 4 }),
    );
    const props = setup({ receipts: [item(ATT2, "Earlier.jpg")] });
    pick(png());
    await waitFor(() => expect(props.onChange).toHaveBeenCalled());

    expect(props.ensureDraft).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/o/alder/reimbursements/${REQ}/receipts`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(["file"]);
    expect((form.get("file") as File).name).toBe("Hardware store.png");

    expect(props.onChange).toHaveBeenCalledWith({
      receipts: [item(ATT2, "Earlier.jpg"), { id: ATT, displayName: "Hardware store.jpg", contentType: "image/jpeg", byteSize: 4321 }],
      revision: 4,
    });
    expect(screen.queryByTestId("receipt-error")).toBeNull();
  });

  it("uses the request id the draft save returned on a brand-new form", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { attachmentId: ATT, displayName: "a.jpg", byteSize: 1, contentType: "image/jpeg", revision: 2 }));
    const props = setup({ requestId: null, ensureDraft: vi.fn().mockResolvedValue({ requestId: REQ, revision: 1 }) });
    pick(png("a.png"));
    await waitFor(() => expect(props.onChange).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe(`/o/alder/reimbursements/${REQ}/receipts`);
  });

  it("tells the form it is busy for the whole upload, then not", async () => {
    let release!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    const props = setup();
    pick(png());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId("receipt-add").textContent).toBe(COPY.form.saving);
    expect((screen.getByTestId("receipt-add") as HTMLButtonElement).disabled).toBe(true);
    release(jsonResponse(200, { attachmentId: ATT, displayName: "a.jpg", byteSize: 1, contentType: "image/jpeg", revision: 2 }));
    await waitFor(() => expect(props.onBusyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByTestId("receipt-add").textContent).toBe(COPY.form.addReceipt);
  });

  it("a second pick while one is under way does nothing", async () => {
    let release!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    const props = setup();
    pick(png("one.png"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    pick(png("two.png"));
    release(jsonResponse(200, { attachmentId: ATT, displayName: "one.jpg", byteSize: 1, contentType: "image/jpeg", revision: 2 }));
    await waitFor(() => expect(props.onChange).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(props.ensureDraft).toHaveBeenCalledTimes(1);
  });

  it("clears the input after a pick, so choosing the same file again fires change again", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    setup();
    const file = png();
    Object.defineProperty(input(), "value", { configurable: true, writable: true, value: "C:\\fakepath\\x.png" });
    pick(file);
    expect(input().value).toBe("");
  });

  it("sends nothing when the draft could not be saved (the form has shown why)", async () => {
    const props = setup({ ensureDraft: vi.fn().mockResolvedValue(null) });
    pick(png());
    await waitFor(() => expect(props.onBusyChange).toHaveBeenLastCalledWith(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("receipt-error")).toBeNull();
  });

  it("a PDF over the size cap is refused in words without saving a draft or sending a byte", async () => {
    const props = setup();
    pick(new File([new Uint8Array(4_000_001)], "Big bill.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(screen.getByTestId("receipt-error")).toBeTruthy());
    expect(screen.getByTestId("receipt-error").textContent).toBe(COPY.receipts.tooLarge("Big bill.pdf"));
    expect(props.ensureDraft).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a dropped connection is the form's own 'couldn't save that' sentence, and nothing is added", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const props = setup();
    pick(png());
    await waitFor(() => expect(screen.getByTestId("receipt-error").textContent).toBe(COPY.form.saveFailed));
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("a 2FA refusal says so and sends the person to the challenge", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { kind: "two_factor_required", redirectTo: "/totp?callbackUrl=%2Fo%2Falder" }));
    setup();
    pick(png());
    await waitFor(() => expect(screen.getByTestId("receipt-error").textContent).toBe(COPY.receipts.twoFactorRequired));
    expect(push).toHaveBeenCalledWith("/totp?callbackUrl=%2Fo%2Falder");
  });

  it("never follows a redirect (the proxy sends a lapsed session to /signin or /totp): it goes to the request's edit page, where the sign-in keeps the way back, and shows no message", async () => {
    fetchMock.mockResolvedValue({ type: "opaqueredirect", ok: false, status: 0, json: () => Promise.reject(new Error("no body")) });
    const props = setup();
    pick(png());
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/o/alder/reimbursements/${REQ}/edit`));
    expect(fetchMock.mock.calls[0]![1].redirect).toBe("manual");
    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("receipt-error")).toBeNull();
  });

  it("a success body that is not the shape promised is not added to the list", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { attachmentId: ATT }));
    const props = setup();
    pick(png());
    await waitFor(() => expect(screen.getByTestId("receipt-error").textContent).toBe(COPY.form.saveFailed));
    expect(props.onChange).not.toHaveBeenCalled();
  });
});

describe("uploadFailureMessage (route kind to Copy C4, naming the person's own file)", () => {
  const NAME = "Hardware store.png";
  it.each([
    ["too_large", COPY.receipts.tooLarge(NAME)],
    ["not_allowed", COPY.receipts.notAllowed(NAME)],
    ["unreadable", COPY.receipts.unreadable(NAME)],
    ["too_many", COPY.receipts.tooMany],
    ["duplicate", COPY.receipts.duplicate],
    ["not_editable", COPY.receipts.notEditable],
    ["rate_limited", COPY.receipts.rateLimited],
    ["two_factor_required", COPY.receipts.twoFactorRequired],
    ["not_found", COPY.form.saveFailed],
    ["failed", COPY.form.saveFailed],
    ["something_new", COPY.form.saveFailed],
  ])("%s", (kind, sentence) => {
    expect(uploadFailureMessage({ kind }, NAME)).toBe(sentence);
  });

  it("a gate refusal shows the gate's own sentence; none, or an empty one, is the generic failure", () => {
    expect(uploadFailureMessage({ kind: "refused", error: COPY.gate.notPermitted }, NAME)).toBe(COPY.gate.notPermitted);
    expect(uploadFailureMessage({ kind: "refused" }, NAME)).toBe(COPY.form.saveFailed);
    expect(uploadFailureMessage({ kind: "refused", error: "" }, NAME)).toBe(COPY.form.saveFailed);
    expect(uploadFailureMessage(null, NAME)).toBe(COPY.form.saveFailed);
  });

  it("every refusal the route can answer shows in the slot as that sentence (through the real fetch path)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(413, { kind: "too_large" }));
    setup();
    pick(png("Kitchen.png"));
    await waitFor(() => expect(screen.getByTestId("receipt-error").textContent).toBe(COPY.receipts.tooLarge("Kitchen.png")));
  });
});

describe("ReceiptSlot - removing a receipt", () => {
  it("detaches through the action and reports the list without it and the new revision", async () => {
    detachReceiptAction.mockResolvedValue({ ok: true, data: { revision: 6 } });
    const props = setup({ receipts: [item(ATT, "a.jpg"), item(ATT2, "b.jpg")] });
    fireEvent.click(screen.getByRole("button", { name: "Remove a.jpg" }));
    await waitFor(() => expect(props.onChange).toHaveBeenCalled());
    expect(detachReceiptAction).toHaveBeenCalledWith("alder", { requestId: REQ, attachmentId: ATT });
    expect(props.onChange).toHaveBeenCalledWith({ receipts: [item(ATT2, "b.jpg")], revision: 6 });
  });

  it("a refusal shows its sentence and keeps the receipt", async () => {
    detachReceiptAction.mockResolvedValue({ ok: false, error: COPY.receipts.notEditable });
    const props = setup({ receipts: [item(ATT, "a.jpg")] });
    fireEvent.click(screen.getByTestId("receipt-remove"));
    await waitFor(() => expect(screen.getByTestId("receipt-error").textContent).toBe(COPY.receipts.notEditable));
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("a thrown action is the generic sentence and keeps the receipt", async () => {
    detachReceiptAction.mockRejectedValue(new Error("network"));
    const props = setup({ receipts: [item(ATT, "a.jpg")] });
    fireEvent.click(screen.getByTestId("receipt-remove"));
    await waitFor(() => expect(screen.getByTestId("receipt-error").textContent).toBe(COPY.form.saveFailed));
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("a 2FA refusal sends the person to the challenge", async () => {
    detachReceiptAction.mockResolvedValue({ ok: false, error: COPY.receipts.twoFactorRequired, kind: "two_factor_required", redirectTo: "/totp?callbackUrl=x" });
    setup({ receipts: [item(ATT, "a.jpg")] });
    fireEvent.click(screen.getByTestId("receipt-remove"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/totp?callbackUrl=x"));
  });
});
