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

describe("H3 — a one-time-code consumer must render <HydrationGate> (DECISION-192)", () => {
  const OTC_IMPORT = 'import { OneTimeCodeInput } from "@/components/shared/one-time-code-input";';

  const GATED_OTC = `${IMPORT}
${OTC_IMPORT}
export function F() {
  return <HydrationGate><form><OneTimeCodeInput name="token" /></form></HydrationGate>;
}`;

  it("passes a gated consumer", () => {
    expect(checkHydrationGate([f("src/app/a/totp-form.tsx", GATED_OTC)])).toEqual([]);
  });

  it("fails an ungated consumer, naming the import line", () => {
    const v = checkHydrationGate([
      f("src/app/a/totp-form.tsx", `${OTC_IMPORT}\nexport const F = () => <form><OneTimeCodeInput name="t" /></form>;`),
    ]);
    expect(rules(v)).toEqual(["H3"]);
    expect(v[0].file).toBe("src/app/a/totp-form.tsx");
    expect(v[0].line).toBe(1);
    expect(v[0].message).toContain("OneTimeCodeInput");
  });

  it("fails when the gate is imported but never rendered", () => {
    const v = checkHydrationGate([
      f("src/app/a/totp-form.tsx", `${IMPORT}\n${OTC_IMPORT}\nexport const F = () => <form />;`),
    ]);
    expect(rules(v)).toEqual(["H3"]);
    expect(v[0].message).toContain("<HydrationGate> element");
  });

  it("fails when the gate is rendered but not imported", () => {
    const v = checkHydrationGate([
      f("src/app/a/totp-form.tsx", `${OTC_IMPORT}\nexport const F = () => <HydrationGate />;`),
    ]);
    expect(rules(v)).toEqual(["H3"]);
    expect(v[0].message).toContain("the import");
  });

  it("fails when the gate element appears only in a comment", () => {
    const v = checkHydrationGate([
      f("src/app/a/totp-form.tsx", `${IMPORT}\n${OTC_IMPORT}\n// <HydrationGate> goes here\nexport const F = () => <form />;`),
    ]);
    expect(rules(v)).toEqual(["H3"]);
  });

  it("catches a multi-line import at its `from` line", () => {
    const v = checkHydrationGate([
      f(
        "src/app/a/totp-form.tsx",
        'import {\n  OneTimeCodeInput,\n} from "@/components/shared/one-time-code-input";\nexport const F = () => <form />;',
      ),
    ]);
    expect(rules(v)).toEqual(["H3"]);
    expect(v[0].line).toBe(3);
  });

  it("passes an exempt consumer (reason on the line above)", () => {
    expect(
      checkHydrationGate([
        f("src/app/a/totp-form.tsx", `// hydration-gate-ok: rendered only inside a dialog opened by a click\n${OTC_IMPORT}\nexport const F = () => <form />;`),
      ]),
    ).toEqual([]);
  });

  it("passes an exempt consumer (reason on the same line)", () => {
    expect(
      checkHydrationGate([
        f("src/app/a/totp-form.tsx", `${OTC_IMPORT} // hydration-gate-ok: client-only dialog\nexport const F = () => <form />;`),
      ]),
    ).toEqual([]);
  });

  it("fails an exemption with no reason", () => {
    const v = checkHydrationGate([
      f("src/app/a/totp-form.tsx", `// hydration-gate-ok:\n${OTC_IMPORT}\nexport const F = () => <form />;`),
    ]);
    expect(rules(v)).toEqual(["H3"]);
    expect(v[0].message).toContain("needs a reason");
  });

  it("ignores a test file that imports the component", () => {
    expect(
      checkHydrationGate([f("src/app/a/totp-form.test.tsx", `${OTC_IMPORT}\nit("x", () => {});`)]),
    ).toEqual([]);
  });

  it("does not flag the component's own file or its siblings that merely mention the path", () => {
    expect(
      checkHydrationGate([
        f(
          "src/components/shared/one-time-code-input.tsx",
          'export function OneTimeCodeInput() { return <input />; }\n// imported as "@/components/shared/one-time-code-input"',
        ),
      ]),
    ).toEqual([]);
  });

  it("does not apply to a .ts file (a type import cannot render the component)", () => {
    expect(
      checkHydrationGate([
        f("src/app/a/types.ts", 'import type { OneTimeCodeInputProps } from "@/components/shared/one-time-code-input";'),
      ]),
    ).toEqual([]);
  });

  it("reports H3 and H1 independently when a file breaks both", () => {
    const v = checkHydrationGate([
      f("src/app/a/mixed.tsx", `${OTC_IMPORT}\nconst form = useForm<V>({});\nexport const F = () => <form />;`),
    ]);
    expect(rules(v).sort()).toEqual(["H1", "H3"]);
  });
});
