// @vitest-environment jsdom
/** The filter (E21): narrows to "n of N", says so when nothing matches, and restores on clear. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TableFilter } from "./table-filter";

afterEach(cleanup);

function mount() {
  render(
    <>
      <TableFilter total={3} />
      <section data-section>
        <ul>
          <li data-haystack="roll_actions the roll">roll</li>
          <li data-haystack="people a person">people</li>
        </ul>
      </section>
      <section data-section>
        <ul>
          <li data-haystack="events a calendar">events</li>
        </ul>
      </section>
    </>,
  );
  return screen.getByLabelText("Find") as HTMLInputElement;
}

describe("TableFilter", () => {
  it("starts with every table, the total, and no empty line", () => {
    mount();
    expect(screen.getByText("3 tables")).toBeTruthy();
    expect(screen.getByRole("status", { hidden: true }).hidden).toBe(true);
  });

  it("narrows to n of N and hides a section with nothing left", () => {
    const input = mount();
    fireEvent.change(input, { target: { value: "roll" } });

    expect(screen.getByText("1 of 3")).toBeTruthy();
    const sections = document.querySelectorAll<HTMLElement>("[data-section]");
    expect(sections[0].hidden).toBe(false);
    expect(sections[1].hidden).toBe(true);
  });

  it("filtered to nothing reads 0 of N with a plain line, and clearing restores everything", () => {
    const input = mount();
    fireEvent.change(input, { target: { value: "zzz-nothing" } });

    expect(screen.getByText("0 of 3")).toBeTruthy();
    const empty = screen.getByText(
      "No table matches that. Clear the search to see all 3.",
    );
    expect(empty.hidden).toBe(false);

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("3 tables")).toBeTruthy();
    expect(empty.hidden).toBe(true);
    for (const el of document.querySelectorAll<HTMLElement>("[data-haystack]")) {
      expect(el.hidden).toBe(false);
    }
  });
});
