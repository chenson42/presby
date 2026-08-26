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
  it("shows the designed empty state with a CTA when canCreate", () => {
    render(
      <MembersList
        slug="alder-creek"
        entries={[]}
        canCreate={true}
        canEdit={true}
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
      />,
    );
    expect(screen.getByText(/no members yet/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /add person/i })).toBeNull();
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
      />,
    );
    expect(screen.queryByRole("link", { name: /^edit$/i })).toBeNull();
  });
});
