import { describe, expect, it } from "vitest";
import { validateDescription } from "./description";
import { applyToolbar, type ToolbarAction, type ToolbarState } from "./toolbar";

/** Builds a state from text with `|` markers for the selection: "a|b|c" or a single "|" for a caret. */
function at(marked: string): ToolbarState {
  const first = marked.indexOf("|");
  const second = marked.indexOf("|", first + 1);
  if (second === -1) {
    return { value: marked.replace("|", ""), start: first, end: first };
  }
  const value = marked.replace(/\|/g, "");
  return { value, start: first, end: second - 1 };
}

/** The inverse of `at`, for readable expectations. */
function show(state: ToolbarState): string {
  const { value, start, end } = state;
  if (start === end) return `${value.slice(0, start)}|${value.slice(start)}`;
  return `${value.slice(0, start)}|${value.slice(start, end)}|${value.slice(end)}`;
}

function run(marked: string, action: ToolbarAction): string {
  return show(applyToolbar(at(marked), action));
}

describe("heading and subheading", () => {
  it("an empty selection on an empty line inserts the marker and keeps the caret after it", () => {
    expect(run("|", "heading")).toBe("## |");
    expect(run("|", "subheading")).toBe("### |");
  });

  it("a caret in the middle of a line marks that whole line", () => {
    expect(run("Du|ties", "heading")).toBe("## Du|ties");
  });

  it("a one-word selection marks its line and selects the line", () => {
    expect(run("Our |Duties| here", "heading")).toBe("|## Our Duties here|");
  });

  it("a second press removes the marker", () => {
    expect(run("|## Duties|", "heading")).toBe("|Duties|");
    expect(run("## Du|ties", "heading")).toBe("Du|ties");
  });

  it("a subheading becomes a heading rather than stacking", () => {
    expect(run("|### Duties|", "heading")).toBe("|## Duties|");
    expect(run("|## Duties|", "subheading")).toBe("|### Duties|");
  });

  it("works on every selected line and leaves blank lines alone", () => {
    expect(run("|One\n\nTwo|", "heading")).toBe("|## One\n\n## Two|");
    expect(run("|## One\n\n## Two|", "heading")).toBe("|One\n\nTwo|");
  });

  it("only the lines touched change", () => {
    expect(run("Before\n|Middle|\nAfter", "heading")).toBe("Before\n|## Middle|\nAfter");
  });

  it("a selection ending just after a newline does not take the next line", () => {
    expect(run("|One\n|Two", "heading")).toBe("|## One|\nTwo");
  });

  it("mixed lines: if not every line has the marker, all get it", () => {
    expect(run("|## One\nTwo|", "heading")).toBe("|## One\n## Two|");
  });
});

describe("bulleted and numbered lists", () => {
  it("bullets on an empty line", () => {
    expect(run("|", "bullets")).toBe("- |");
  });

  it("bullets on several lines, and off again", () => {
    expect(run("|One\nTwo\nThree|", "bullets")).toBe("|- One\n- Two\n- Three|");
    expect(run("|- One\n- Two\n- Three|", "bullets")).toBe("|One\nTwo\nThree|");
  });

  it("numbers count the lines that got one", () => {
    expect(run("|One\nTwo\nThree|", "numbers")).toBe("|1. One\n2. Two\n3. Three|");
    expect(run("|1. One\n2. Two|", "numbers")).toBe("|One\nTwo|");
  });

  it("numbers skip blank lines but keep counting", () => {
    expect(run("|One\n\nTwo|", "numbers")).toBe("|1. One\n\n2. Two|");
  });

  it("switching list type replaces the marker", () => {
    expect(run("|- One\n- Two|", "numbers")).toBe("|1. One\n2. Two|");
    expect(run("|1. One\n2. Two|", "bullets")).toBe("|- One\n- Two|");
    expect(run("|## One|", "bullets")).toBe("|- One|");
  });

  it("a caret on a list line toggles that line", () => {
    expect(run("- On|e", "bullets")).toBe("On|e");
  });
});

describe("bold and italic", () => {
  it("an empty selection inserts the markers with the caret between them", () => {
    expect(run("a | b", "bold")).toBe("a **|** b");
    expect(run("a | b", "italic")).toBe("a *|* b");
  });

  it("wraps a one-word selection and keeps it selected", () => {
    expect(run("a |word| b", "bold")).toBe("a **|word|** b");
    expect(run("a |word| b", "italic")).toBe("a *|word|* b");
  });

  it("a second press unwraps (markers outside the selection)", () => {
    expect(run("a **|word|** b", "bold")).toBe("a |word| b");
    expect(run("a *|word|* b", "italic")).toBe("a |word| b");
  });

  it("a second press unwraps (markers inside the selection)", () => {
    expect(run("a |**word**| b", "bold")).toBe("a |word| b");
    expect(run("a |*word*| b", "italic")).toBe("a |word| b");
  });

  it("wraps a multi-line selection", () => {
    expect(run("|one\ntwo|", "bold")).toBe("**|one\ntwo|**");
  });

  it("italic does not unwrap the edge of a bold pair", () => {
    // `**word**` with word selected: italic wraps rather than eating one star of each pair.
    const result = applyToolbar(at("**|word|**"), "italic");
    expect(result.value).toBe("***word***");
  });

  it("bold at the very start of the text", () => {
    expect(run("|Hi| there", "bold")).toBe("**|Hi|** there");
    expect(run("**|Hi|** there", "bold")).toBe("|Hi| there");
  });
});

describe("link", () => {
  it("wraps a selection and selects the https:// placeholder", () => {
    const result = applyToolbar(at("See |our site| now"), "link");
    expect(result.value).toBe("See [our site](https://) now");
    expect(result.value.slice(result.start, result.end)).toBe("https://");
  });

  it("with nothing selected inserts a labelled link with the placeholder selected", () => {
    const result = applyToolbar(at("See |"), "link");
    expect(result.value).toBe("See [your link text](https://)");
    expect(result.value.slice(result.start, result.end)).toBe("https://");
  });

  it("the unfinished link it inserts is refused by the validator, by name", () => {
    const result = applyToolbar(at("|apply|"), "link");
    const check = validateDescription(result.value, { requireNonEmpty: false });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errors[0]!.code).toBe("link_unfinished");
  });
});

describe("robustness", () => {
  it("clamps an out-of-range or reversed selection", () => {
    expect(applyToolbar({ value: "abc", start: 99, end: -4 }, "heading").value).toBe("## abc");
    expect(applyToolbar({ value: "abc", start: 3, end: 1 }, "bold").value).toBe("a**bc**");
  });

  it("an empty document accepts every action", () => {
    for (const action of ["heading", "subheading", "bold", "italic", "bullets", "numbers", "link"] as const) {
      expect(() => applyToolbar({ value: "", start: 0, end: 0 }, action), action).not.toThrow();
    }
  });

  it("a caret at position 0 of a non-empty first line works (no lastIndexOf(-1) trap)", () => {
    expect(applyToolbar({ value: "\nabc", start: 0, end: 0 }, "heading").value).toBe("## \nabc");
    expect(applyToolbar({ value: "abc", start: 0, end: 0 }, "heading").value).toBe("## abc");
  });
});
