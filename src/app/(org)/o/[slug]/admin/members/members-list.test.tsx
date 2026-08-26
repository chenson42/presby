// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MembersList } from "./members-list";
import type { DirectoryEntry } from "@/lib/directory";

afterEach(cleanup);

const ENTRY: DirectoryEntry = {
  personId: "p-1",
  firstName: "Nora",
  lastName: "Ashgrove",
  preferredName: null,
  email: "nora@example.invalid",
  phone: null,
  address: null,
  dateOfBirth: null,
  photoKey: null,
};

describe("MembersList — empty state", () => {
  it("shows the designed empty state with a CTA when canCreate and no filter is active", () => {
    render(
      <MembersList
        slug="alder-creek"
        entries={[]}
        canCreate={true}
        canEdit={true}
        search=""
        status=""
      />,
    );
    expect(screen.getByText(/no members yet/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /add person/i })).toBeTruthy();
  });

  it("omits the CTA in the empty state when the viewer cannot create", () => {
    render(
      <MembersList
        slug="alder-creek"
        entries={[]}
        canCreate={false}
        canEdit={false}
        search=""
        status=""
      />,
    );
    expect(screen.getByText(/no members yet/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /add person/i })).toBeNull();
  });

  it("shows a search-specific empty message (not the product-empty state) when a search matched nobody", () => {
    render(
      <MembersList
        slug="alder-creek"
        entries={[]}
        canCreate={true}
        canEdit={true}
        search="zzzznomatch"
        status=""
      />,
    );
    expect(screen.queryByText(/no members yet/i)).toBeNull();
    expect(screen.getByText(/no matches for "zzzznomatch"/i)).toBeTruthy();
  });

  it("shows a status-specific empty message when a status filter matched nobody", () => {
    render(
      <MembersList
        slug="alder-creek"
        entries={[]}
        canCreate={true}
        canEdit={true}
        search=""
        status="baptized"
      />,
    );
    expect(
      screen.getByText(/no members with status "baptized"/i),
    ).toBeTruthy();
  });
});

describe("MembersList — rendering entries", () => {
  it("links each card to the person's directory detail page", () => {
    render(
      <MembersList
        slug="alder-creek"
        entries={[ENTRY]}
        canCreate={true}
        canEdit={true}
        search=""
        status=""
      />,
    );
    const link = screen.getByRole("link", { name: /nora ashgrove/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/directory/p-1");
  });

  it("shows an Edit link to the edit route when canEdit", () => {
    render(
      <MembersList
        slug="alder-creek"
        entries={[ENTRY]}
        canCreate={true}
        canEdit={true}
        search=""
        status=""
      />,
    );
    const editLink = screen.getByRole("link", { name: /^edit$/i });
    expect(editLink.getAttribute("href")).toBe(
      "/o/alder-creek/admin/members/p-1/edit",
    );
  });

  it("omits the Edit link when the viewer cannot edit", () => {
    render(
      <MembersList
        slug="alder-creek"
        entries={[ENTRY]}
        canCreate={false}
        canEdit={false}
        search=""
        status=""
      />,
    );
    expect(screen.queryByRole("link", { name: /^edit$/i })).toBeNull();
  });
});

describe("MembersList — search + status filter form", () => {
  it("renders a search input and a status select with every DIRECTORY_STATUSES option", () => {
    render(
      <MembersList
        slug="alder-creek"
        entries={[]}
        canCreate={true}
        canEdit={true}
        search=""
        status=""
      />,
    );
    expect(screen.getByLabelText(/search members/i)).toBeTruthy();
    const select = screen.getByLabelText(/status/i) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual([
      "",
      "active",
      "baptized",
      "affiliate",
      "other_participant",
    ]);
  });

  it("pre-fills the search input and selects the current status from props", () => {
    render(
      <MembersList
        slug="alder-creek"
        entries={[ENTRY]}
        canCreate={true}
        canEdit={true}
        search="Nora"
        status="active"
      />,
    );
    expect(
      (screen.getByLabelText(/search members/i) as HTMLInputElement).value,
    ).toBe("Nora");
    expect((screen.getByLabelText(/status/i) as HTMLSelectElement).value).toBe(
      "active",
    );
  });
});

describe("MembersList — pagination", () => {
  it("renders Pagination when a pagination prop is passed with more than one page", () => {
    render(
      <MembersList
        slug="alder-creek"
        entries={[ENTRY]}
        canCreate={true}
        canEdit={true}
        search=""
        status=""
        pagination={{ page: 1, pageSize: 25, total: 30, totalPages: 2 }}
      />,
    );
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  });

  it("renders no pagination controls when pagination is omitted", () => {
    render(
      <MembersList
        slug="alder-creek"
        entries={[ENTRY]}
        canCreate={true}
        canEdit={true}
        search=""
        status=""
      />,
    );
    expect(screen.queryByText(/page \d+ of \d+/i)).toBeNull();
  });
});
