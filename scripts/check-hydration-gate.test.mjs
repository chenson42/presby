/**
 * Fixture tests for the hydration-gate tripwire (DECISION-159). Synthetic
 * files are fed straight to checkHydrationGate(), which takes
 * { path, content } rather than reading the disk.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import { checkHydrationGate } from "./check-hydration-gate.mjs";

/** @param {string} path @param {string} content */
const f = (path, content) => ({ path, content });
const rules = (v) => v.map((x) => x.rule);

const IMPORT = 'import { HydrationGate } from "@/components/shared/hydration-gate";';

const GATED = `${IMPORT}
export function F() {
  const form = useForm<V>({ defaultValues: {} });
  return <HydrationGate><form /></HydrationGate>;
}`;

describe("H1 — useForm roots must render <HydrationGate>", () => {
  it("passes a gated useForm<V>( file", () => {
    expect(checkHydrationGate([f("src/app/a/form.tsx", GATED)])).toEqual([]);
  });

  it("passes a gated useForm( file (no generic)", () => {
    expect(
      checkHydrationGate([f("src/app/a/form.tsx", GATED.replace("useForm<V>(", "useForm("))]),
    ).toEqual([]);
  });

  it("fails an ungated file, naming the useForm line", () => {
    const v = checkHydrationGate([
      f("src/app/a/form.tsx", "export function F() {\n  const form = useForm<V>({});\n  return <form />;\n}"),
    ]);
    expect(rules(v)).toEqual(["H1"]);
    expect(v[0].file).toBe("src/app/a/form.tsx");
    expect(v[0].line).toBe(2);
  });

  it("fails when the gate is imported but never rendered", () => {
    const v = checkHydrationGate([
      f("src/app/a/form.tsx", `${IMPORT}\nconst form = useForm<V>({});\nconst x = <form />;`),
    ]);
    expect(rules(v)).toEqual(["H1"]);
    expect(v[0].message).toContain("<HydrationGate> element");
  });

  it("fails when the element appears only in a comment", () => {
    const v = checkHydrationGate([
      f(
        "src/app/a/form.tsx",
        `${IMPORT}\nconst form = useForm<V>({});\n// <HydrationGate> goes here\n{/* <HydrationGate> */}`,
      ),
    ]);
    expect(rules(v)).toEqual(["H1"]);
  });

  it("fails when the element is rendered but the gate is not imported", () => {
    const v = checkHydrationGate([
      f("src/app/a/form.tsx", "const form = useForm<V>({});\nconst x = <HydrationGate />;"),
    ]);
    expect(rules(v)).toEqual(["H1"]);
    expect(v[0].message).toContain("the import");
  });

  it("ignores useForm that appears only in a comment", () => {
    expect(
      checkHydrationGate([
        f("src/app/a/form.tsx", "// we call useForm<V>( elsewhere\n/**\n * useForm(\n */\nexport const x = 1;"),
      ]),
    ).toEqual([]);
  });

  it("does not flag useFormState / useFormStatus / useFormContext", () => {
    expect(
      checkHydrationGate([
        f(
          "src/app/a/form.tsx",
          "const a = useFormState(x);\nconst b = useFormStatus();\nconst c = useFormContext();\nconst d = useFormat(1);",
        ),
      ]),
    ).toEqual([]);
  });

  it("ignores test files", () => {
    expect(
      checkHydrationGate([
        f("src/app/a/form.test.tsx", "const form = useForm<V>({});"),
        f("src/app/a/form.test.ts", "const form = useForm({});"),
      ]),
    ).toEqual([]);
  });

  it("passes two useForm calls under one gate (add-staff-position-form shape)", () => {
    expect(
      checkHydrationGate([
        f(
          "src/app/a/form.tsx",
          `${IMPORT}\nconst form = useForm<A>({});\nconst personForm = useForm<B>({});\nconst x = <HydrationGate><form /></HydrationGate>;`,
        ),
      ]),
    ).toEqual([]);
  });
});

describe("exemption — // hydration-gate-ok: <reason>", () => {
  it("passes with the exemption on the same line", () => {
    expect(
      checkHydrationGate([
        f("src/app/a/form.tsx", "const form = useForm<V>({}); // hydration-gate-ok: client-only dialog"),
      ]),
    ).toEqual([]);
  });

  it("passes with the exemption on the line above", () => {
    expect(
      checkHydrationGate([
        f("src/app/a/form.tsx", "// hydration-gate-ok: client-only dialog\nconst form = useForm<V>({});"),
      ]),
    ).toEqual([]);
  });

  it("fails an exemption with no reason", () => {
    const v = checkHydrationGate([
      f("src/app/a/form.tsx", "// hydration-gate-ok:\nconst form = useForm<V>({});"),
    ]);
    expect(rules(v)).toEqual(["H1"]);
    expect(v[0].message).toContain("needs a reason");
  });

  it("fails a call two lines below the exemption", () => {
    const v = checkHydrationGate([
      f("src/app/a/form.tsx", "// hydration-gate-ok: reason\n\nconst form = useForm<V>({});"),
    ]);
    expect(rules(v)).toEqual(["H1"]);
  });
});

describe("H2 — useForm in a .ts file", () => {
  it("fails a .ts file that calls useForm", () => {
    const v = checkHydrationGate([
      f("src/app/a/use-thing.ts", "export function useThing() {\n  return useForm<V>({});\n}"),
    ]);
    expect(rules(v)).toEqual(["H2"]);
  });

  it("passes a .ts file with the exemption", () => {
    expect(
      checkHydrationGate([
        f("src/app/a/use-thing.ts", "// hydration-gate-ok: only called from gated roots\nexport const x = () => useForm({});"),
      ]),
    ).toEqual([]);
  });
});
