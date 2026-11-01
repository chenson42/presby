// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AmountField, centsToDigits, normalizeDigits } from "./amount-field";

afterEach(cleanup);

describe("normalizeDigits", () => {
  it("keeps digits, drops leading zeros, refuses more digits than any legal amount has", () => {
    expect(normalizeDigits("$12.50")).toBe("1250");
    expect(normalizeDigits("$0.05")).toBe("5");
    expect(normalizeDigits("$0.0")).toBe("");
    expect(normalizeDigits("123456789")).toBeNull();
    expect(normalizeDigits("1e5")).toBe("15");
  });
  it("centsToDigits", () => {
    expect(centsToDigits(null)).toBe("");
    expect(centsToDigits(0)).toBe("");
    expect(centsToDigits(4250)).toBe("4250");
  });
});

describe("AmountField", () => {
  const setup = (value = "") => {
    const onChange = vi.fn();
    const onRejectedPaste = vi.fn();
    render(<AmountField id="a" value={value} onChange={onChange} onRejectedPaste={onRejectedPaste} />);
    return { input: screen.getByRole("textbox") as HTMLInputElement, onChange, onRejectedPaste };
  };
  const paste = (el: HTMLElement, text: string) =>
    fireEvent.paste(el, { clipboardData: { getData: () => text } });

  it("shows the digits as dollars and cents, empty as empty", () => {
    expect(setup("1250").input.value).toBe("$12.50");
    cleanup();
    expect(setup("").input.value).toBe("");
  });
  it("typing reports the digit string", () => {
    const { input, onChange } = setup("125");
    fireEvent.change(input, { target: { value: "$1.256" } });
    expect(onChange).toHaveBeenCalledWith("1256");
  });
  it("ignores a ninth digit", () => {
    const { input, onChange } = setup("10000000");
    fireEvent.change(input, { target: { value: "$100,000.001" } });
    expect(onChange).not.toHaveBeenCalled();
  });
  it("reads a pasted amount exactly, and refuses one that would need rounding", () => {
    const { input, onChange, onRejectedPaste } = setup();
    paste(input, "$1,234.5");
    expect(onChange).toHaveBeenCalledWith("123450");
    paste(input, "12.345");
    expect(onRejectedPaste).toHaveBeenCalledTimes(1);
    paste(input, "1e5");
    paste(input, "-5");
    paste(input, "٣");
    paste(input, "100000.01");
    expect(onRejectedPaste).toHaveBeenCalledTimes(5);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("raises the numeric keypad", () => {
    expect(setup().input.getAttribute("inputmode")).toBe("numeric");
  });
});
