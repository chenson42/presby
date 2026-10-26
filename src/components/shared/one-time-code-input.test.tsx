// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const hydrated = vi.hoisted(() => ({ value: true }));
vi.mock("@/components/shared/use-hydrated", () => ({
  useHydrated: () => hydrated.value,
}));

import {
  OneTimeCodeInput,
  type OneTimeCodeInputProps,
} from "./one-time-code-input";

beforeEach(() => {
  hydrated.value = true;
});
afterEach(cleanup);

type HarnessProps = Partial<
  Omit<OneTimeCodeInputProps, "value" | "onValueChange">
> & { initial?: string; onChange?: (v: string) => void };

/** Holds the value the way a real parent does, so the component is exercised controlled. */
function Harness({ initial = "", onChange, ...rest }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <OneTimeCodeInput
        name="token"
        label="6-digit code"
        value={value}
        onValueChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
        {...rest}
      />
      <button type="button" onClick={() => setValue("")}>
        reset
      </button>
    </>
  );
}

const boxes = () =>
  Array.from({ length: 6 }, (_, i) =>
    screen.getByLabelText(`Digit ${i + 1} of 6`),
  ) as HTMLInputElement[];
const hidden = () =>
  document.querySelector('input[type="hidden"][name="token"]') as HTMLInputElement;
const values = () => boxes().map((b) => b.value);
const type = (box: HTMLElement, v: string) => fireEvent.change(box, { target: { value: v } });
const paste = (box: HTMLElement, text: string) =>
  fireEvent.paste(box, { clipboardData: { getData: () => text } });

describe("OneTimeCodeInput — structure", () => {
  it("renders six labelled boxes in a named group and one hidden input; the boxes carry no name", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "6-digit code" })).toBeTruthy();
    expect(boxes()).toHaveLength(6);
    for (const b of boxes()) {
      expect(b.getAttribute("name")).toBeNull();
      expect(b.getAttribute("type")).toBe("text");
      expect(b.getAttribute("inputmode")).toBe("numeric");
      // No maxLength: an autofill that delivers several characters must be able to land.
      expect(b.hasAttribute("maxlength")).toBe(false);
    }
    expect(document.querySelectorAll('[name="token"]')).toHaveLength(1);
    expect(hidden().value).toBe("");
  });

  it("puts one-time-code autocomplete on box 1 only", () => {
    render(<Harness />);
    const [first, ...rest] = boxes();
    expect(first!.getAttribute("autocomplete")).toBe("one-time-code");
    for (const b of rest) expect(b.getAttribute("autocomplete")).toBe("off");
  });

  it("the visible label focuses box 1", () => {
    render(<Harness />);
    expect(screen.getByText("6-digit code").getAttribute("for")).toBe(boxes()[0]!.id);
  });

  it("honours a different length", () => {
    render(
      <OneTimeCodeInput name="c" label="Code" value="" onValueChange={() => {}} length={4} />,
    );
    expect(screen.getAllByLabelText(/Digit \d of 4/)).toHaveLength(4);
  });

  it("wires invalid and describedBy onto every box", () => {
    render(<Harness invalid describedBy="why" />);
    for (const b of boxes()) {
      expect(b.getAttribute("aria-invalid")).toBe("true");
      expect(b.getAttribute("aria-describedby")).toBe("why");
    }
  });

  it("disables every box", () => {
    render(<Harness disabled />);
    for (const b of boxes()) expect(b.disabled).toBe(true);
  });
});

describe("OneTimeCodeInput — focus on mount", () => {
  it("does not focus anything by default", () => {
    render(<Harness />);
    expect(document.activeElement).toBe(document.body);
  });

  it("focuses box 1 once hydrated when autoFocus is set", () => {
    render(<Harness autoFocus />);
    expect(document.activeElement).toBe(boxes()[0]);
  });

  it("does not use the HTML autofocus attribute (a disabled gate cannot take focus)", () => {
    render(<Harness autoFocus />);
    for (const b of boxes()) expect(b.hasAttribute("autofocus")).toBe(false);
  });

  it("waits for hydration, then focuses box 1", () => {
    hydrated.value = false;
    const { rerender } = render(<Harness autoFocus />);
    expect(document.activeElement).toBe(document.body);
    hydrated.value = true;
    rerender(<Harness autoFocus />);
    expect(document.activeElement).toBe(boxes()[0]);
  });

  it("does not steal focus back on a later render", () => {
    const { rerender } = render(<Harness autoFocus />);
    boxes()[3]!.focus();
    rerender(<Harness autoFocus />);
    expect(document.activeElement).toBe(boxes()[3]);
  });
});

describe("OneTimeCodeInput — typing", () => {
  it("writes a digit and advances to the next box", () => {
    render(<Harness autoFocus />);
    type(boxes()[0]!, "4");
    expect(values()).toEqual(["4", "", "", "", "", ""]);
    expect(document.activeElement).toBe(boxes()[1]);
    expect(hidden().value).toBe("4");
  });

  it("types a whole code box to box", () => {
    render(<Harness autoFocus />);
    "123456".split("").forEach((d, i) => type(boxes()[i]!, d));
    expect(values()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(hidden().value).toBe("123456");
    // Stays on the last box.
    expect(document.activeElement).toBe(boxes()[5]);
  });

  it("ignores a non-digit and leaves the box as it was", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    type(boxes()[0]!, "x");
    expect(values()[0]).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps leading zeros", () => {
    render(<Harness />);
    "007".split("").forEach((d, i) => type(boxes()[i]!, d));
    expect(hidden().value).toBe("007");
  });

  it("accepts full-width digits as ASCII digits", () => {
    render(<Harness />);
    type(boxes()[0]!, "７");
    expect(values()[0]).toBe("7");
    expect(hidden().value).toBe("7");
  });

  it("overtype: the newly typed digit replaces the old one", () => {
    render(<Harness initial="1" />);
    // The caret was after the "1"; the keystroke delivers "13".
    type(boxes()[0]!, "13");
    expect(values()[0]).toBe("3");
    expect(document.activeElement).toBe(boxes()[1]);
  });

  it("select-all-and-delete (an input event with an empty value) clears the box and stays put", () => {
    render(<Harness initial="123456" />);
    boxes()[2]!.focus();
    type(boxes()[2]!, "");
    expect(values()).toEqual(["1", "2", "", "4", "5", "6"]);
    expect(document.activeElement).toBe(boxes()[2]);
  });
});

describe("OneTimeCodeInput — multi-character input (autofill, suggestion, drop)", () => {
  it("spreads a six-digit autofill delivered to box 1 across every box", () => {
    render(<Harness />);
    boxes()[0]!.focus();
    type(boxes()[0]!, "482915");
    expect(values()).toEqual(["4", "8", "2", "9", "1", "5"]);
    expect(hidden().value).toBe("482915");
    expect(document.activeElement).toBe(boxes()[5]);
  });

  it("takes the first six of a longer run", () => {
    render(<Harness />);
    type(boxes()[3]!, "12345678");
    expect(hidden().value).toBe("123456");
  });

  it("a shorter run is written from the focused box and focus lands on the first empty box", () => {
    render(<Harness />);
    type(boxes()[0]!, "12");
    // Box 1 and 2 were filled by the two characters; focus lands on box 3.
    expect(values()).toEqual(["1", "2", "", "", "", ""]);
    expect(document.activeElement).toBe(boxes()[2]);
  });

  it("clips a run that would pass the last box", () => {
    render(<Harness />);
    type(boxes()[4]!, "999");
    expect(values()).toEqual(["", "", "", "", "9", "9"]);
  });
});

describe("OneTimeCodeInput — paste", () => {
  it("distributes a pasted code and prevents the default paste", () => {
    render(<Harness />);
    const notPrevented = paste(boxes()[0]!, "123456");
    expect(notPrevented).toBe(false);
    expect(values()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(hidden().value).toBe("123456");
  });

  it("drops spaces, hyphens and newlines", () => {
    render(<Harness />);
    paste(boxes()[0]!, " 123 - 456\n");
    expect(hidden().value).toBe("123456");
  });

  it("takes the first six digits of a longer paste, starting at box 1 whichever box had focus", () => {
    render(<Harness />);
    paste(boxes()[4]!, "98765432");
    expect(hidden().value).toBe("987654");
  });

  it("a short paste fills from the box it landed in", () => {
    render(<Harness />);
    paste(boxes()[2]!, "55");
    expect(values()).toEqual(["", "", "5", "5", "", ""]);
  });

  it("ignores a paste with no digits", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    paste(boxes()[0]!, "abc-def");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("OneTimeCodeInput — Backspace, Delete and arrows", () => {
  for (const key of ["Backspace", "Delete"] as const) {
    describe(key, () => {
      it("clears a filled box and stays on it", () => {
        render(<Harness initial="123456" />);
        boxes()[3]!.focus();
        fireEvent.keyDown(boxes()[3]!, { key });
        expect(values()).toEqual(["1", "2", "3", "", "5", "6"]);
        expect(document.activeElement).toBe(boxes()[3]);
      });

      it("on an empty box, moves to the previous box and clears it", () => {
        render(<Harness initial="12" />);
        boxes()[2]!.focus();
        fireEvent.keyDown(boxes()[2]!, { key });
        expect(values()).toEqual(["1", "", "", "", "", ""]);
        expect(document.activeElement).toBe(boxes()[1]);
        expect(hidden().value).toBe("1");
      });

      it("erases a whole code by repeated presses, across boxes", () => {
        render(<Harness initial="123456" />);
        boxes()[5]!.focus();
        for (let n = 0; n < 6; n++) {
          fireEvent.keyDown(document.activeElement as HTMLElement, { key });
        }
        expect(values()).toEqual(["", "", "", "", "", ""]);
        expect(hidden().value).toBe("");
      });

      it("on an empty first box does nothing", () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        boxes()[0]!.focus();
        fireEvent.keyDown(boxes()[0]!, { key });
        expect(onChange).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(boxes()[0]);
      });

      it("prevents the default so no stale digit is left behind", () => {
        render(<Harness initial="1" />);
        boxes()[0]!.focus();
        expect(fireEvent.keyDown(boxes()[0]!, { key })).toBe(false);
      });
    });
  }

  it("a cleared middle box leaves a hole, so the emitted code is short (not submittable)", () => {
    render(<Harness initial="123456" />);
    boxes()[2]!.focus();
    fireEvent.keyDown(boxes()[2]!, { key: "Backspace" });
    expect(hidden().value).toBe("12456");
    expect(hidden().value).toHaveLength(5);
  });

  it("ArrowLeft, ArrowRight, Home and End move between boxes", () => {
    render(<Harness initial="123456" />);
    boxes()[2]!.focus();
    fireEvent.keyDown(boxes()[2]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(boxes()[3]);
    fireEvent.keyDown(boxes()[3]!, { key: "ArrowLeft" });
    fireEvent.keyDown(boxes()[2]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(boxes()[1]);
    fireEvent.keyDown(boxes()[1]!, { key: "End" });
    expect(document.activeElement).toBe(boxes()[5]);
    fireEvent.keyDown(boxes()[5]!, { key: "Home" });
    expect(document.activeElement).toBe(boxes()[0]);
  });

  it("arrows stop at the ends", () => {
    render(<Harness />);
    boxes()[0]!.focus();
    fireEvent.keyDown(boxes()[0]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(boxes()[0]);
    boxes()[5]!.focus();
    fireEvent.keyDown(boxes()[5]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(boxes()[5]);
  });

  it("leaves Ctrl and Meta chords alone (select-all, copy)", () => {
    render(<Harness initial="123456" />);
    boxes()[1]!.focus();
    expect(fireEvent.keyDown(boxes()[1]!, { key: "Backspace", ctrlKey: true })).toBe(true);
    expect(values()).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("selects a box's content when it takes focus, so a typed digit replaces it", () => {
    render(<Harness initial="123456" />);
    const box = boxes()[1]!;
    const select = vi.spyOn(box, "select");
    box.focus();
    expect(select).toHaveBeenCalled();
  });
});

describe("OneTimeCodeInput — onComplete", () => {
  it("fires once when the sixth digit completes the code, with the code", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    "12345".split("").forEach((d, i) => type(boxes()[i]!, d));
    expect(onComplete).not.toHaveBeenCalled();
    type(boxes()[5]!, "6");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456", { exact: true });
  });

  it("does not fire on mount, even with a complete initial value", () => {
    const onComplete = vi.fn();
    render(<Harness initial="123456" onComplete={onComplete} />);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("fires for a paste that completes the code", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    paste(boxes()[0]!, "123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not fire when an edit leaves the code unchanged", () => {
    const onComplete = vi.fn();
    render(<Harness initial="123456" onComplete={onComplete} />);
    type(boxes()[2]!, "3");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("does not fire while a hole keeps the code short, and fires once when the hole is filled", () => {
    const onComplete = vi.fn();
    render(<Harness initial="123456" onComplete={onComplete} />);
    boxes()[2]!.focus();
    fireEvent.keyDown(boxes()[2]!, { key: "Backspace" });
    type(boxes()[4]!, "9");
    expect(hidden().value).toBe("12496");
    expect(onComplete).not.toHaveBeenCalled();
    type(boxes()[2]!, "3");
    expect(hidden().value).toBe("123496");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123496", { exact: true });
  });

  // DECISION-257: a consumer may submit only when `exact` is true.
  it("C-1: a typed sixth digit reports exact", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    "123456".split("").forEach((d, i) => type(boxes()[i]!, d));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456", { exact: true });
  });

  it("C-2: a paste of more than six digits fills six boxes and reports not-exact, once", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    paste(boxes()[0]!, "1234567");
    expect(values()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456", { exact: false });
  });

  it("C-2b: a multi-character autofill of more than six digits reports not-exact", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    type(boxes()[0]!, "98765432");
    expect(onComplete).toHaveBeenCalledWith("987654", { exact: false });
  });

  // Decision 3 is about the property "a truncated input waits for the button":
  // exact is false whenever a delivered digit was dropped, not only for a run
  // longer than the code (QA O-1).
  it("C-4: a short paste that overflows the remaining boxes fills to six, drops a digit, and reports not-exact", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    "123".split("").forEach((d, i) => type(boxes()[i]!, d));
    paste(boxes()[3]!, "4567");
    expect(values()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(hidden().value).toBe("123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456", { exact: false });
  });

  it("C-4b: a paste that exactly fills the remaining boxes reports exact; a full code pasted into a later box replaces the whole code and reports exact", () => {
    const onFit = vi.fn();
    const { unmount } = render(<Harness onComplete={onFit} />);
    "123".split("").forEach((d, i) => type(boxes()[i]!, d));
    paste(boxes()[3]!, "456");
    expect(onFit).toHaveBeenCalledWith("123456", { exact: true });
    unmount();

    const onFull = vi.fn();
    render(<Harness initial="123" onComplete={onFull} />);
    paste(boxes()[3]!, "654321");
    expect(values()).toEqual(["6", "5", "4", "3", "2", "1"]);
    expect(onFull).toHaveBeenCalledWith("654321", { exact: true });
  });

  it("C-3: a spaced paste and a whole-code fill on box 1 report exact", () => {
    const onPaste = vi.fn();
    const { unmount } = render(<Harness onComplete={onPaste} />);
    paste(boxes()[0]!, "123 456");
    expect(onPaste).toHaveBeenCalledWith("123456", { exact: true });
    unmount();

    const onFill = vi.fn();
    render(<Harness onComplete={onFill} />);
    type(boxes()[0]!, "482915");
    expect(onFill).toHaveBeenCalledTimes(1);
    expect(onFill).toHaveBeenCalledWith("482915", { exact: true });
  });

  it("C-4: a repeated identical whole-code input event reports completion once", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    type(boxes()[0]!, "482915");
    type(boxes()[0]!, "482915");
    paste(boxes()[0]!, "482915");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("OneTimeCodeInput — controlled value", () => {
  it("clears every box when the parent resets the value", () => {
    render(<Harness initial="123456" />);
    fireEvent.click(screen.getByText("reset"));
    expect(values()).toEqual(["", "", "", "", "", ""]);
    expect(hidden().value).toBe("");
  });

  it("shows an initial value across the boxes", () => {
    render(<Harness initial="1234" />);
    expect(values()).toEqual(["1", "2", "3", "4", "", ""]);
  });

  it("never emits a non-digit even if the parent passes one", () => {
    render(<Harness initial="12a4" />);
    expect(hidden().value).toBe("124");
  });
});
