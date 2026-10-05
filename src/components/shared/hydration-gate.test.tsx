// @vitest-environment jsdom
/**
 * HydrationGate (DECISION-159, F116). Includes the react-hook-form integration
 * tests that prove the gate closes the pre-hydration window without corrupting
 * what RHF submits, and the ungated characterisation twin that reproduces the
 * original bug in jsdom.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { useEffect } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import { useForm, type UseFormReset } from "react-hook-form";
import { HydrationGate } from "./hydration-gate";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

type Values = {
  cong: string;
  note: string;
  n: string;
  pub: boolean;
  kind: string;
};

const DEFAULTS: Values = {
  cong: "a",
  note: "stored",
  n: "",
  pub: true,
  kind: "x",
};

type HarnessProps = {
  gated: boolean;
  onValid: (v: Values) => void;
  resetRef?: { current: UseFormReset<Values> | null };
};

function Harness({ gated, onValid, resetRef }: HarnessProps) {
  const form = useForm<Values>({ defaultValues: DEFAULTS });
  const { reset } = form;
  useEffect(() => {
    if (resetRef) resetRef.current = reset;
  }, [reset, resetRef]);
  const body = (
    <form onSubmit={form.handleSubmit(onValid)}>
      <select id="cong" {...form.register("cong")}>
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
      <input id="note" type="text" {...form.register("note")} />
      <input id="n" type="number" {...form.register("n")} />
      <input id="pub" type="checkbox" {...form.register("pub")} />
      <input id="kind-x" type="radio" value="x" {...form.register("kind")} />
      <input id="kind-y" type="radio" value="y" {...form.register("kind")} />
      <button type="submit">Save</button>
    </form>
  );
  return gated ? <HydrationGate>{body}</HydrationGate> : body;
}

function ssrInto(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = renderToString(node);
  return container;
}

const q = <T extends Element>(c: Element, sel: string) => c.querySelector(sel) as T;

describe("HydrationGate markup", () => {
  it("server render is a disabled, busy fieldset with the reset classes and no legend", () => {
    const html = renderToString(
      <HydrationGate>
        <button type="button">x</button>
      </HydrationGate>,
    );
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-slot="hydration-gate"');
    expect(html).toContain("m-0 min-w-0 border-0 p-0");
    expect(html).not.toContain("<legend");
  });

  it("merges a passed className", () => {
    const html = renderToString(
      <HydrationGate className="max-w-xl">
        <span />
      </HydrationGate>,
    );
    expect(html).toContain("max-w-xl");
    expect(html).toContain("min-w-0");
  });

  it("enables after hydrateRoot: no disabled, no aria-busy, children once, no mismatch", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const node = (
      <HydrationGate>
        <button type="button">go</button>
      </HydrationGate>
    );
    const container = ssrInto(node);
    const before = q<HTMLFieldSetElement>(container, "fieldset");
    expect(before.disabled).toBe(true);

    await act(async () => {
      hydrateRoot(container, node);
    });

    const after = q<HTMLFieldSetElement>(container, "fieldset");
    expect(after.disabled).toBe(false);
    expect(after.hasAttribute("aria-busy")).toBe(false);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("a client-only render is enabled immediately", () => {
    render(
      <HydrationGate>
        <button type="button">go</button>
      </HydrationGate>,
    );
    expect(screen.getByRole("button", { name: "go" }).matches(":disabled")).toBe(false);
  });
});

describe("HydrationGate with react-hook-form", () => {
  it("every control is :disabled in the server HTML", () => {
    const container = ssrInto(<Harness gated onValid={() => {}} />);
    for (const sel of ["#cong", "#note", "#n", "#pub", "#kind-x", "#kind-y", "button"]) {
      expect(q<HTMLElement>(container, sel).matches(":disabled"), sel).toBe(true);
    }
  });

  it("submits the complete defaults, untouched, once enabled (checkbox/radio defaults survive)", async () => {
    const onValid = vi.fn();
    const node = <Harness gated onValid={onValid} />;
    const container = ssrInto(node);
    await act(async () => {
      hydrateRoot(container, node);
    });
    expect(q<HTMLElement>(container, "#cong").matches(":disabled")).toBe(false);

    await act(async () => {
      q<HTMLFormElement>(container, "form").requestSubmit();
    });

    expect(onValid).toHaveBeenCalledTimes(1);
    expect(onValid.mock.calls[0][0]).toEqual(DEFAULTS);
  });

  it("submits edited values for every field once enabled", async () => {
    const onValid = vi.fn();
    const node = <Harness gated onValid={onValid} />;
    const container = ssrInto(node);
    await act(async () => {
      hydrateRoot(container, node);
    });

    fireEvent.change(q(container, "#cong"), { target: { value: "b" } });
    fireEvent.input(q(container, "#note"), { target: { value: "edited" } });
    fireEvent.click(q(container, "#kind-y"));
    await act(async () => {
      q<HTMLFormElement>(container, "form").requestSubmit();
    });

    expect(onValid.mock.calls[0][0]).toEqual({
      cong: "b",
      note: "edited",
      n: "",
      pub: true,
      kind: "y",
    });
  });

  it("form.reset(...) after success still repopulates the DOM and the next submit", async () => {
    const onValid = vi.fn();
    const resetRef: { current: UseFormReset<Values> | null } = { current: null };
    const node = <Harness gated onValid={onValid} resetRef={resetRef} />;
    const container = ssrInto(node);
    await act(async () => {
      hydrateRoot(container, node);
    });

    await act(async () => {
      resetRef.current?.({ cong: "b", note: "after", n: "7", pub: false, kind: "y" });
    });
    expect(q<HTMLSelectElement>(container, "#cong").value).toBe("b");
    expect(q<HTMLInputElement>(container, "#note").value).toBe("after");
    expect(q<HTMLInputElement>(container, "#pub").checked).toBe(false);
    expect(q<HTMLInputElement>(container, "#kind-y").checked).toBe(true);

    await act(async () => {
      q<HTMLFormElement>(container, "form").requestSubmit();
    });
    expect(onValid.mock.calls[0][0]).toEqual({
      cong: "b",
      note: "after",
      n: "7",
      pub: false,
      kind: "y",
    });
  });

  it("a client-only render of the gated form is operable immediately", () => {
    render(<Harness gated onValid={() => {}} />);
    expect(screen.getByRole("button", { name: "Save" }).matches(":disabled")).toBe(false);
  });

  // Characterisation twin (the unit-lane negative control). If this ever
  // fails, React or RHF changed how mount reconciliation works: re-read
  // DECISION-159 before deleting it.
  it("WITHOUT the gate a pre-hydration pick and edit are overwritten (F116/F122 in jsdom)", async () => {
    const node = <Harness gated={false} onValid={() => {}} />;
    const container = ssrInto(node);
    q<HTMLSelectElement>(container, "#cong").value = "b";
    q<HTMLInputElement>(container, "#note").value = "typed early";

    await act(async () => {
      hydrateRoot(container, node);
    });

    expect(q<HTMLSelectElement>(container, "#cong").value).toBe("a");
    expect(q<HTMLInputElement>(container, "#note").value).toBe("stored");
  });
});
