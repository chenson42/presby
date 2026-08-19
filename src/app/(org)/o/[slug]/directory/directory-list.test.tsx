// @vitest-environment jsdom
/**
 * Tests for <DirectoryList> — the single-column card list.
 *
 * The load-bearing assertions here are the ones the brief calls out
 * explicitly: a null field is OMITTED, never rendered as an empty label
 * (e.g. no "Phone:" with nothing after it), the mailto:/tel: links are
 * sized to the 44px touch-target floor, and the zero-entries state reads as
 * "no one is listed yet" rather than a blank list.
 *
 * No jest-dom matchers — see directory-states.test.tsx's header.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DirectoryEntry } from "@/lib/directory";
import { DirectoryList } from "./directory-list";

afterEach(cleanup);

function entry(overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    personId: "c0000000-0000-0000-0000-000000000001",
    firstName: "Marguerite",
    lastName: "Ashcombe",
    preferredName: null,
    email: null,
    phone: null,
    address: null,
    dateOfBirth: null,
    photoKey: null,
    ...overrides,
  };
}

describe("DirectoryList — zero entries", () => {
  it("renders an honest empty message, not a blank list", () => {
    render(<DirectoryList entries={[]} />);
    expect(screen.getByText(/no one is listed in the directory yet/i)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("DirectoryList — name", () => {
  it("prefers preferredName over firstName when present", () => {
    render(
      <DirectoryList
        entries={[entry({ firstName: "Marguerite", preferredName: "Meg" })]}
      />,
    );
    expect(screen.getByText("Meg Ashcombe")).toBeTruthy();
    expect(screen.queryByText("Marguerite Ashcombe")).toBeNull();
  });

  it("falls back to firstName when preferredName is null", () => {
    render(<DirectoryList entries={[entry({ preferredName: null })]} />);
    expect(screen.getByText("Marguerite Ashcombe")).toBeTruthy();
  });
});

describe("DirectoryList — null fields are omitted, not shown empty", () => {
  it("renders no contact links when email, phone, and address are all null", () => {
    render(<DirectoryList entries={[entry()]} />);
    expect(screen.queryByRole("link")).toBeNull();
    // No leftover "Email:" / "Phone:" label with nothing after it.
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/email:/i);
    expect(body).not.toMatch(/phone:/i);
  });

  it("renders only the email link when phone and address are null", () => {
    render(
      <DirectoryList
        entries={[entry({ email: "m.ashcombe@example.invalid" })]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe(
      "mailto:m.ashcombe@example.invalid",
    );
  });

  it("renders only the phone link when email and address are null", () => {
    render(<DirectoryList entries={[entry({ phone: "555-0100" })]} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("tel:555-0100");
  });

  it("renders both contact links, each sized to the 44px touch-target floor", () => {
    render(
      <DirectoryList
        entries={[
          entry({
            email: "m.ashcombe@example.invalid",
            phone: "555-0100",
          }),
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.className).toContain("min-h-11");
    }
  });

  it("renders only the address lines that came back non-null", () => {
    render(
      <DirectoryList
        entries={[
          entry({
            address: {
              line1: null,
              city: "Fixtureville",
              region: "OH",
              postalCode: "00000",
            },
          }),
        ]}
      />,
    );
    const body = document.body.textContent ?? "";
    expect(body).toContain("Fixtureville, OH, 00000");
    // No stray comma/empty segment where line1 would have been.
    expect(body).not.toMatch(/,\s*,/);
  });
});

describe("DirectoryList — multiple entries", () => {
  it("renders one list item per entry, keyed by personId", () => {
    render(
      <DirectoryList
        entries={[
          entry({ personId: "a", firstName: "Marguerite", lastName: "Ashcombe" }),
          entry({ personId: "b", firstName: "Tobias", lastName: "Renwick" }),
        ]}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Marguerite Ashcombe")).toBeTruthy();
    expect(screen.getByText("Tobias Renwick")).toBeTruthy();
  });
});
