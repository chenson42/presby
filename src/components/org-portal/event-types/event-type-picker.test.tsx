// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useForm, useWatch } from "react-hook-form";
import type { EventTypePickerOption } from "@/lib/events";
import { EventTypePicker } from "./event-type-picker";

afterEach(cleanup);

const OPTIONS: EventTypePickerOption[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Worship", colorToken: "teal", iconKey: "Church", isRetired: false },
  { id: "22222222-2222-4222-8222-222222222222", name: "Old Study", colorToken: "sky", iconKey: "BookOpen", isRetired: true },
];

function Harness({
  options = OPTIONS,
  fallbackName = "General" as string | null,
  onValue,
}: {
  options?: EventTypePickerOption[];
  fallbackName?: string | null;
  onValue?: (v: string) => void;
}) {
  const { register, control } = useForm({ defaultValues: { eventTypeId: "none" } });
  const value = useWatch({ control, name: "eventTypeId" });
  onValue?.(value);
  return (
    <EventTypePicker id="t" selectProps={register("eventTypeId")} options={options} fallbackName={fallbackName} />
  );
}

describe("EventTypePicker", () => {
  it("labels the select 'Event type (optional)' and hints that it colors the calendar", () => {
    render(<Harness />);
    const select = screen.getByLabelText("Event type (optional)");
    expect(select.tagName).toBe("SELECT");
    expect(select.getAttribute("aria-describedby")).toBe("t-hint");
    expect(screen.getByText("Colors the event on the calendar.").id).toBe("t-hint");
  });

  it("offers 'No type (shown as <fallback>)' first, with the sentinel value 'none'", () => {
    render(<Harness />);
    const select = screen.getByLabelText("Event type (optional)") as HTMLSelectElement;
    expect(select.options[0].value).toBe("none");
    expect(select.options[0].textContent).toBe("No type (shown as General)");
    expect(select.value).toBe("none");
  });

  it("says just 'No type' when the organization has no default type", () => {
    render(<Harness fallbackName={null} />);
    expect((screen.getByLabelText("Event type (optional)") as HTMLSelectElement).options[0].textContent).toBe("No type");
  });

  it("flags a retired current type as '(retired)'", () => {
    render(<Harness />);
    const labels = Array.from((screen.getByLabelText("Event type (optional)") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toEqual(["No type (shown as General)", "Worship", "Old Study (retired)"]);
  });

  it("writes the chosen id into the registered field", () => {
    let latest = "";
    render(<Harness onValue={(v) => (latest = v)} />);
    fireEvent.change(screen.getByLabelText("Event type (optional)"), { target: { value: OPTIONS[0].id } });
    expect(latest).toBe(OPTIONS[0].id);
  });

  it("renders nothing when there is nothing to choose", () => {
    const { container } = render(<Harness options={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("styles the select with appearance-none and disabled: variants (it sits inside a HydrationGate)", () => {
    render(<Harness />);
    const cls = screen.getByLabelText("Event type (optional)").className;
    expect(cls).toContain("appearance-none");
    expect(cls).toContain("disabled:opacity-50");
  });
});
