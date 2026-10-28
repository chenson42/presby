// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DescriptionEditor } from "./description-editor";

afterEach(cleanup);

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <DescriptionEditor value={value} onChange={setValue} />;
}

const textarea = () => screen.getByLabelText("Description") as HTMLTextAreaElement;

function select(start: number, end = start) {
  const el = textarea();
  el.focus();
  el.setSelectionRange(start, end);
}

function paste(html: string, plain = "") {
  fireEvent.paste(textarea(), {
    clipboardData: { getData: (type: string) => (type === "text/html" ? html : type === "text/plain" ? plain : "") },
  });
}

describe("DescriptionEditor - T21", () => {
  it("shows the Copy S6 hint, the seven toolbar buttons and 44px targets", () => {
    render(<Harness />);
    expect(
      screen.getByText(
        "Leave a blank line between paragraphs. Use the buttons to add headings, bold text, lists and links. Pasting from Word or Google Docs keeps headings, bold, italics, lists and links; check the preview afterwards.",
      ),
    ).toBeTruthy();
    const names = ["Heading", "Subheading", "Bold", "Italic", "Bulleted list", "Numbered list", "Link"];
    for (const name of names) {
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("type")).toBe("button");
      expect(button.className).toContain("min-h-11");
    }
    expect(screen.getByTestId("description-toolbar").querySelectorAll("button")).toHaveLength(7);
  });

  it("the textarea is 16px text (no iOS zoom)", () => {
    render(<Harness />);
    expect(textarea().className).toContain("text-base");
    expect(textarea().className).not.toContain("text-sm");
  });

  it("the toolbar applies applyToolbar to the selection and keeps focus on the textarea", () => {
    render(<Harness initial="Hello world" />);
    select(6, 11);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(textarea().value).toBe("Hello **world**");
    expect(document.activeElement).toBe(textarea());
    // A second press unwraps.
    select(8, 13);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(textarea().value).toBe("Hello world");
  });

  it("block buttons work per line, and Link leaves the https:// placeholder selected", () => {
    render(<Harness initial="Duties" />);
    select(0);
    fireEvent.click(screen.getByRole("button", { name: "Subheading" }));
    expect(textarea().value).toBe("### Duties");
    select(0, textarea().value.length);
    fireEvent.click(screen.getByRole("button", { name: "Subheading" }));
    expect(textarea().value).toBe("Duties");

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(textarea().value).toContain("](https://)");
    expect(textarea().value.slice(textarea().selectionStart, textarea().selectionEnd)).toBe("https://");
  });

  it("an unfinished link is listed as a problem with its line, and the count follows the text", () => {
    render(<Harness initial={"Intro\n\n[Apply](https://)"} />);
    expect(screen.getByTestId("description-errors").textContent).toBe('Line 3: finish the web address for the link "Apply", or remove the link.');
    expect(screen.getByTestId("description-count").textContent).toBe("24 of 20,000 characters");
  });

  it("a single # is refused by name, with the line and the text", () => {
    render(<Harness initial="# Big title" />);
    expect(screen.getByTestId("description-errors").textContent).toBe(
      'Line 1 ("# Big title") starts with a single #. Use the Heading or Subheading button for section titles.',
    );
  });

  it("over 20,000 characters turns the counter into the limit error", () => {
    render(<Harness initial={"a".repeat(20001)} />);
    expect(screen.getByTestId("description-count").textContent).toBe("20,001 of 20,000 characters");
    expect(screen.getByTestId("description-errors").textContent).toBe("The description is too long. The limit is 20,000 characters.");
  });

  it("the preview renders the shared component, and says so when empty", () => {
    const { unmount } = render(<Harness />);
    expect(screen.getByText("Preview")).toBeTruthy();
    expect(screen.getByText("Nothing to preview yet.")).toBeTruthy();
    unmount();
    render(<Harness initial={"## Duties\n\n- one"} />);
    expect(screen.getByRole("heading", { level: 2, name: "Duties" })).toBeTruthy();
    expect(screen.getByTestId("description-preview").querySelector('[data-testid="posting-description"]')).toBeTruthy();
  });

  it("a hostile description previews as inert text", () => {
    render(<Harness initial={"<script>alert(1)</script> [x](javascript:alert(1))"} />);
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByTestId("description-preview").querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("pasting HTML converts it to markdown at the selection", () => {
    render(<Harness initial="Before  after" />);
    select(7);
    paste("<h2>Duties</h2><ul><li>One</li><li>Two</li></ul>");
    expect(textarea().value).toBe("Before \n\n## Duties\n\n- One\n- Two\n\nafter");
  });

  it("a converted paste at the end of a line gets a blank-line boundary - regression for the glued heading", () => {
    render(<Harness initial="Intro line" />);
    select(10);
    paste("<h2>Duties</h2>");
    expect(textarea().value).toBe("Intro line\n\n## Duties");
  });

  it("a heading pasted into the middle of a line does not glue the following text to it - regression for the glued trailing text", () => {
    render(<Harness initial="Before after" />);
    select(7);
    paste("<h2>Duties</h2>");
    expect(textarea().value).toBe("Before \n\n## Duties\n\nafter");
    expect(textarea().selectionStart).toBe("Before \n\n## Duties".length);
  });

  it("no trailing boundary when the caret is at the end of a line or the rest of the line is blank", () => {
    render(<Harness initial={"Intro\nNext line"} />);
    select(5);
    paste("<h2>Duties</h2>");
    expect(textarea().value).toBe("Intro\n\n## Duties\nNext line");
  });

  it("a converted paste after a single newline adds just the missing newline; after a blank line or at the start adds none", () => {
    const { unmount } = render(<Harness initial={"Intro\n"} />);
    select(6);
    paste("<h2>Duties</h2>");
    expect(textarea().value).toBe("Intro\n\n## Duties");
    unmount();
    render(<Harness initial={"Intro\n\n"} />);
    select(7);
    paste("<h2>Duties</h2>");
    expect(textarea().value).toBe("Intro\n\n## Duties");
    cleanup();
    render(<Harness initial="" />);
    paste("<h2>Duties</h2>");
    expect(textarea().value).toBe("## Duties");
  });

  it("pasting plain text (no HTML) is left to the browser", () => {
    render(<Harness initial="x" />);
    const notPrevented = fireEvent.paste(textarea(), { clipboardData: { getData: () => "" } });
    expect(notPrevented).toBe(true);
    expect(textarea().value).toBe("x");
  });

  it("falls back to the browser's paste when the converter declines (oversize)", () => {
    render(<Harness initial="x" />);
    const huge = `<p>${"a".repeat(200_001)}</p>`;
    const notPrevented = fireEvent.paste(textarea(), {
      clipboardData: { getData: (t: string) => (t === "text/html" ? huge : "") },
    });
    expect(notPrevented).toBe(true);
    expect(textarea().value).toBe("x");
  });

  it("falls back when the HTML holds nothing textual", () => {
    render(<Harness initial="x" />);
    const notPrevented = fireEvent.paste(textarea(), {
      clipboardData: { getData: (t: string) => (t === "text/html" ? "<img src=x><script>alert(1)</script>" : "") },
    });
    expect(notPrevented).toBe(true);
  });
});
