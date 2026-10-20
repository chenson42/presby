// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GIVE_PAGE, GIVING_UNAVAILABLE } from "@/lib/giving/giving-copy";
import { GivingUnavailableNotice } from "./giving-unavailable-notice";

afterEach(cleanup);

describe("GivingUnavailableNotice", () => {
  it("names the congregation, says nothing was charged, and offers the church's phone as a link", () => {
    render(<GivingUnavailableNotice organizationName="Alder Creek Presbyterian Church" contactPhone="614-555-0123" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(GIVING_UNAVAILABLE.heading);
    expect(screen.getByText(/Alder Creek Presbyterian Church isn't taking online gifts/)).toBeTruthy();
    expect(screen.getByText(/Nothing has been charged/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "614-555-0123" }).getAttribute("href")).toBe("tel:6145550123");
  });

  it("without a phone it says to contact the church, and never renders the form", () => {
    const { container } = render(<GivingUnavailableNotice organizationName="Alder Creek" contactPhone={null} />);
    expect(screen.getByText(GIVE_PAGE.contactGeneric)).toBeTruthy();
    expect(container.querySelector("form, input")).toBeNull();
  });

  it("is an h2 inside the live slot, where the host page owns the h1", () => {
    render(<GivingUnavailableNotice organizationName="Alder Creek" contactPhone={null} headingLevel={2} />);
    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("a phone that is not a phone number is shown as text, not as a tel link", () => {
    render(<GivingUnavailableNotice organizationName="Alder Creek" contactPhone="ask at the office" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/ask at the office/)).toBeTruthy();
  });
});
