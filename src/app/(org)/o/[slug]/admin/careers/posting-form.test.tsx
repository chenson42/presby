// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STALE_MESSAGE } from "@/lib/careers/messages";
import type { PostingRow } from "@/lib/careers/postings";

const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockSetStatus = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  createPostingAction: (...a: unknown[]) => mockCreate(...a),
  updatePostingAction: (...a: unknown[]) => mockUpdate(...a),
  setPostingStatusAction: (...a: unknown[]) => mockSetStatus(...a),
  movePostingAction: vi.fn(),
}));
const mockPush = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush, refresh: mockRefresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

import { PostingForm } from "./posting-form";

afterEach(() => {
  cleanup();
  for (const mock of [mockCreate, mockUpdate, mockSetStatus, mockPush, mockRefresh, toastSuccess, toastError]) mock.mockReset();
});

function posting(overrides: Partial<PostingRow> = {}): PostingRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "custodian",
    title: "Custodian",
    summary: "Care for the building.",
    location: "Main campus",
    employmentType: "full_time",
    payMinCents: 4500,
    payMaxCents: 6000,
    payUnit: "hour",
    descriptionMd: "## About\n\nKeep it clean.",
    closingDate: null,
    status: "draft",
    sortOrder: 0,
    version: 3,
    postedOn: null,
    firstPublishedAt: null,
    closedAt: null,
    updatedAt: "2026-11-01T00:00:00Z",
    visibleToPublic: false,
    ...overrides,
  };
}

const field = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement;
async function submit(name = "Save draft") {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("PostingForm - T21", () => {
  it("is a disabled fieldset on the server render (HydrationGate), status buttons included", () => {
    const html = renderToString(<PostingForm slug="alder-creek" posting={posting()} orgToday="2026-11-03" />);
    expect(html).toMatch(/<fieldset[^>]*disabled=""[^>]*data-slot="hydration-gate"|<fieldset[^>]*data-slot="hydration-gate"[^>]*disabled=""/);
    expect(html).toContain('aria-busy="true"');
    // The two status buttons carry their own disabled state too, independent of the fieldset.
    expect(html.match(/<button[^>]*disabled=""[^>]*>(Publish|Discard this draft)</g)).toHaveLength(2);
  });

  it("create: shows the Copy S6 labels and hints", () => {
    render(<PostingForm slug="alder-creek" />);
    for (const label of ["Title", "Location", "Type", "Lowest", "Highest", "Short summary", "Closing date (optional)", "Web address", "Description"]) {
      expect(screen.getByLabelText(new RegExp(`^${label.replace(/[()]/g, "\\$&")}`)), label).toBeTruthy();
    }
    expect(screen.getByText("Pay (optional)")).toBeTruthy();
    expect(screen.getByText("Leave blank if you don't want to show pay.")).toBeTruthy();
    expect(screen.getByText("One or two sentences shown in the list of openings. Up to 300 characters.")).toBeTruthy();
    expect(screen.getByText("The last day you will accept applications. Leave blank to keep it open until you close it.")).toBeTruthy();
    expect(screen.getByText("Used in this opening's web address. Letters, numbers and dashes. This can't be changed after you publish.")).toBeTruthy();
    expect(screen.getByText("…/careers/")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
    // Type options are the Copy labels.
    expect([...(field("Type") as unknown as HTMLSelectElement).options].map((o) => o.text)).toEqual(["Full-time", "Part-time", "Intern"]);
  });

  it("create: a title is required (Copy S6) and nothing is sent", async () => {
    render(<PostingForm slug="alder-creek" />);
    await submit();
    expect(await screen.findByText("Enter a title.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("create: sends cents, the unit and the typed fields, toasts 'Draft saved.' and opens the new draft", async () => {
    mockCreate.mockResolvedValue({ ok: true, data: { id: "new-id" } });
    render(<PostingForm slug="alder-creek" />);
    fireEvent.change(field(/^Title/), { target: { value: "Music Director" } });
    fireEvent.change(field("Location"), { target: { value: "Sanctuary" } });
    fireEvent.change(field("Type"), { target: { value: "part_time" } });
    fireEvent.change(field("Lowest"), { target: { value: "$52,000" } });
    fireEvent.change(field("Highest"), { target: { value: "60000.50" } });
    fireEvent.change(screen.getByLabelText("Pay (optional)"), { target: { value: "year" } });
    fireEvent.change(field("Short summary"), { target: { value: "Lead the choir." } });
    fireEvent.change(field("Closing date (optional)"), { target: { value: "2027-01-31" } });
    fireEvent.change(field("Description"), { target: { value: "## Duties\n\nSing." } });
    await submit();
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith("alder-creek", {
      title: "Music Director",
      location: "Sanctuary",
      employmentType: "part_time",
      payMinCents: 5200000,
      payMaxCents: 6000050,
      payUnit: "year",
      summary: "Lead the choir.",
      closingDate: "2027-01-31",
      descriptionMd: "## Duties\n\nSing.",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Draft saved.");
    expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/careers/new-id");
  });

  it("create: the pay unit starts on 'Choose…', and an amount with no unit is refused with Copy S6 - regression for the silent per-hour default", async () => {
    render(<PostingForm slug="alder-creek" />);
    const unit = screen.getByLabelText("Pay (optional)") as HTMLSelectElement;
    expect(unit.value).toBe("");
    expect([...unit.options].map((o) => o.text)).toEqual(["Choose…", "per hour", "per year"]);
    fireEvent.change(field(/^Title/), { target: { value: "Custodian" } });
    fireEvent.change(field("Lowest"), { target: { value: "52,000" } });
    await submit();
    expect(await screen.findByText("Choose per hour or per year.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("create: with no amount the unit is not needed and nothing about pay is sent", async () => {
    mockCreate.mockResolvedValue({ ok: true, data: { id: "new-id" } });
    render(<PostingForm slug="alder-creek" />);
    fireEvent.change(field(/^Title/), { target: { value: "Custodian" } });
    await submit();
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]![1]).toMatchObject({ payMinCents: null, payMaxCents: null, payUnit: null });
  });

  it("create: a server refusal is a toast with its text and the form stays", async () => {
    mockCreate.mockResolvedValue({ ok: false, error: "Another opening already uses that web address. Choose a different one." });
    render(<PostingForm slug="alder-creek" />);
    fireEvent.change(field(/^Title/), { target: { value: "Music Director" } });
    await submit();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Another opening already uses that web address. Choose a different one."));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("field errors: bad dollars, high below low, bad date, bad address - and the description's own error blocks the save", async () => {
    render(<PostingForm slug="alder-creek" />);
    fireEvent.change(field(/^Title/), { target: { value: "T" } });
    fireEvent.change(field("Lowest"), { target: { value: "abc" } });
    fireEvent.change(field("Highest"), { target: { value: "5" } });
    fireEvent.change(field("Web address"), { target: { value: "Not A Slug" } });
    fireEvent.change(field("Description"), { target: { value: "# Too big" } });
    await submit();
    expect(await screen.findByText("Enter a dollar amount like 45 or 52,000.")).toBeTruthy();
    expect(screen.getByText("Use letters, numbers and dashes only.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
    cleanup();

    render(<PostingForm slug="alder-creek" />);
    fireEvent.change(field(/^Title/), { target: { value: "T" } });
    fireEvent.change(field("Lowest"), { target: { value: "60" } });
    fireEvent.change(field("Highest"), { target: { value: "45" } });
    await submit();
    expect(await screen.findByText("The highest pay must be at least the lowest.")).toBeTruthy();
  });

  it("edit: loads the saved values (cents back to dollars) and a locked slug after first publish", () => {
    render(
      <PostingForm
        slug="alder-creek"
        orgToday="2026-11-03"
        posting={posting({ status: "published", firstPublishedAt: "2026-10-30T00:00:00Z", postedOn: "2026-10-30", visibleToPublic: true, payMinCents: 4550, payMaxCents: 6000 })}
      />,
    );
    expect(field(/^Title/).value).toBe("Custodian");
    expect(field("Lowest").value).toBe("45.50");
    expect(field("Highest").value).toBe("60");
    const slug = field("Web address");
    expect(slug.value).toBe("custodian");
    expect(slug.readOnly).toBe(true);
    expect(screen.getByText("The web address can't be changed after an opening is published, because people may have saved or shared it.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });

  it("edit: a draft keeps its slug editable and says 'Save draft'", () => {
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={posting()} />);
    expect(field("Web address").readOnly).toBe(false);
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
  });

  it("edit: saving sends the id and the loaded version, omits a locked slug, and toasts 'Changes saved.'", async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: { version: 4 } });
    render(
      <PostingForm
        slug="alder-creek"
        orgToday="2026-11-03"
        posting={posting({ status: "published", firstPublishedAt: "2026-10-30T00:00:00Z", postedOn: "2026-10-30", visibleToPublic: true })}
      />,
    );
    fireEvent.change(field(/^Title/), { target: { value: "Head Custodian" } });
    await submit("Save changes");
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, input] = mockUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(input).toMatchObject({ id: "11111111-1111-4111-8111-111111111111", version: 3, title: "Head Custodian" });
    expect("slug" in input).toBe(false);
    expect(toastSuccess).toHaveBeenCalledWith("Changes saved.");
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("edit: a posting with no pay shows 'Choose…' for the unit, and adding an amount without one is refused - regression for the silent per-hour default", async () => {
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={posting({ payMinCents: null, payMaxCents: null, payUnit: null })} />);
    const unit = screen.getByLabelText("Pay (optional)") as HTMLSelectElement;
    expect(unit.value).toBe("");
    fireEvent.change(field("Lowest"), { target: { value: "52,000" } });
    await submit();
    expect(await screen.findByText("Choose per hour or per year.")).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("edit: an unlocked draft sends its slug", async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: { version: 4 } });
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={posting()} />);
    fireEvent.change(field("Web address"), { target: { value: "head-custodian" } });
    await submit();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect((mockUpdate.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ slug: "head-custodian" });
  });

  it("edit: a STALE save keeps the typed text, shows the message with Reload, and does not refresh or toast success", async () => {
    mockUpdate.mockResolvedValue({ ok: false, error: STALE_MESSAGE });
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={posting()} />);
    fireEvent.change(field(/^Title/), { target: { value: "My careful edit" } });
    await submit();
    const alert = await screen.findByTestId("posting-stale");
    expect(alert.textContent).toContain(STALE_MESSAGE);
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(field(/^Title/).value).toBe("My careful edit");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("publishing with unsaved edits saves them first, then publishes the new version", async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: { version: 4 } });
    mockSetStatus.mockResolvedValue({ ok: true, data: { status: "published", version: 5 } });
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={posting()} />);
    fireEvent.change(field(/^Title/), { target: { value: "Head Custodian" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, publish" }));
    });
    await waitFor(() => expect(mockSetStatus).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSetStatus).toHaveBeenCalledWith("alder-creek", { id: "11111111-1111-4111-8111-111111111111", version: 4, to: "published" });
  });

  it("publishing with nothing unsaved goes straight to the loaded version", async () => {
    mockSetStatus.mockResolvedValue({ ok: true, data: { status: "published", version: 4 } });
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={posting()} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, publish" }));
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetStatus).toHaveBeenCalledWith("alder-creek", { id: "11111111-1111-4111-8111-111111111111", version: 3, to: "published" });
  });

  it("publishing with an invalid unsaved edit saves nothing and publishes nothing", async () => {
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={posting()} />);
    fireEvent.change(field("Description"), { target: { value: "# Too big" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, publish" }));
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("We couldn't save that. Try again.");
  });

  it("Publish names the title being typed, not the stored one - regression for the stale dialog title", () => {
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={posting()} />);
    fireEvent.change(field(/^Title/), { target: { value: "Head Custodian" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(screen.getByText('Publish "Head Custodian"?')).toBeTruthy();
    expect(screen.queryByText('Publish "Custodian"?')).toBeNull();
  });

  it("Reopen names the title being typed, not the stored one - regression for the stale dialog title", () => {
    const closed = posting({ status: "closed", firstPublishedAt: "2026-10-01T00:00:00Z", closedAt: "2026-11-02T00:00:00Z" });
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={closed} />);
    fireEvent.change(field(/^Title/), { target: { value: "Head Custodian" } });
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(screen.getByText('Reopen "Head Custodian"?')).toBeTruthy();
    expect(screen.queryByText('Reopen "Custodian"?')).toBeNull();
  });

  const published = () => posting({ status: "published", firstPublishedAt: "2026-10-30T00:00:00Z", postedOn: "2026-10-30", visibleToPublic: true });

  it("Close saves unsaved edits first, then closes the new version - regression for dropped edits", async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: { version: 4 } });
    mockSetStatus.mockResolvedValue({ ok: true, data: { status: "closed", version: 5 } });
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={published()} />);
    fireEvent.change(field("Short summary"), { target: { value: "A typed summary." } });
    fireEvent.click(screen.getByRole("button", { name: "Close this opening" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, close it" }));
    });
    await waitFor(() => expect(mockSetStatus).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect((mockUpdate.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ summary: "A typed summary." });
    expect(mockSetStatus).toHaveBeenCalledWith("alder-creek", { id: "11111111-1111-4111-8111-111111111111", version: 4, to: "closed" });
  });

  it("Close with a failed save leaves the posting open", async () => {
    mockUpdate.mockResolvedValue({ ok: false, error: "Nope." });
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={published()} />);
    fireEvent.change(field("Short summary"), { target: { value: "A typed summary." } });
    fireEvent.click(screen.getByRole("button", { name: "Close this opening" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, close it" }));
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Nope.");
  });

  it("Close with nothing unsaved goes straight to the loaded version", async () => {
    mockSetStatus.mockResolvedValue({ ok: true, data: { status: "closed", version: 4 } });
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={published()} />);
    fireEvent.click(screen.getByRole("button", { name: "Close this opening" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, close it" }));
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetStatus).toHaveBeenCalledWith("alder-creek", { id: "11111111-1111-4111-8111-111111111111", version: 3, to: "closed" });
  });

  it("Discard does not save: the edits go with the discarded draft", async () => {
    mockSetStatus.mockResolvedValue({ ok: true, data: { status: "closed", version: 4 } });
    render(<PostingForm slug="alder-creek" orgToday="2026-11-03" posting={posting()} />);
    fireEvent.change(field(/^Title/), { target: { value: "Head Custodian" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard this draft" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, discard it" }));
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetStatus).toHaveBeenCalledWith("alder-creek", { id: "11111111-1111-4111-8111-111111111111", version: 3, to: "closed" });
  });

  it("a closed posting whose closing date passed gets the Reopen note", () => {
    render(
      <PostingForm
        slug="alder-creek"
        orgToday="2026-11-03"
        posting={posting({ status: "closed", firstPublishedAt: "2026-10-01T00:00:00Z", postedOn: "2026-10-01", closedAt: "2026-11-02T00:00:00Z", closingDate: "2026-10-31" })}
      />,
    );
    expect(screen.getByText("Its closing date has passed. Change the closing date, save, then reopen.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reopen" }).hasAttribute("disabled")).toBe(true);
  });
});
