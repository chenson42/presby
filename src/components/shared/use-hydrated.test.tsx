// @vitest-environment jsdom
/**
 * useHydrated (DECISION-159). The sequence that matters is [false, true] on
 * hydrateRoot over server HTML, and [true] on a client-only render.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { render, act, cleanup } from "@testing-library/react";
import { useHydrated } from "./use-hydrated";

function makeProbe() {
  const seen: boolean[] = [];
  function Probe() {
    const hydrated = useHydrated();
    seen.push(hydrated);
    return <span id="probe">{String(hydrated)}</span>;
  }
  return { Probe, seen };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useHydrated", () => {
  it("is false in a server render", () => {
    const { Probe } = makeProbe();
    expect(renderToString(<Probe />)).toContain(">false<");
  });

  it("is true on the very first render of a client-only mount", () => {
    const { Probe, seen } = makeProbe();
    render(<Probe />);
    expect(seen).toEqual([true]);
  });

  it("renders [false, true] on hydrateRoot over server HTML, with no hydration mismatch", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { Probe, seen } = makeProbe();
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(<Probe />);
    expect(container.textContent).toBe("false");

    await act(async () => {
      hydrateRoot(container, <Probe />);
    });

    // React may render the hydration pass more than once in development, so
    // compare the sequence of distinct values: false first, then true, never
    // true before false.
    expect(seen.filter((v, i) => i === 0 || v !== seen[i - 1])).toEqual([false, true]);
    expect(seen[0]).toBe(false);
    expect(container.textContent).toBe("true");
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
