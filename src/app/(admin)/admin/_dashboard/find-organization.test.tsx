// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FindOrganization } from "./find-organization";

afterEach(cleanup);

describe("FindOrganization", () => {
  it("is a labelled GET form to the organizations list using ?q=", () => {
    render(<FindOrganization />);
    const form = screen.getByRole("search");
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/admin/organizations");
    const input = screen.getByLabelText("Find an organization");
    expect(input.getAttribute("name")).toBe("q");
    expect(input.getAttribute("placeholder")).toBe("Part of a name");
    expect(input.getAttribute("maxlength")).toBe("100");
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
  });
});
