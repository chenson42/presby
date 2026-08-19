/**
 * Unit tests for the ui:add import rewrite.
 *
 * The rewrite runs once per generated primitive and its failure mode is silent:
 * a missed umbrella import compiles fine as long as `radix-ui` happens to be
 * installed, which is exactly the state the lockfile restore is meant to
 * prevent. So the regex is pinned here rather than trusted.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import { kebab, rewriteUmbrellaImports } from "./ui-add.mjs";

describe("kebab", () => {
  it("splits camel case", () => {
    expect(kebab("DropdownMenu")).toBe("dropdown-menu");
    expect(kebab("AlertDialog")).toBe("alert-dialog");
    expect(kebab("NavigationMenu")).toBe("navigation-menu");
  });

  it("leaves a single word alone", () => {
    expect(kebab("Dialog")).toBe("dialog");
    expect(kebab("Slot")).toBe("slot");
  });
});

describe("rewriteUmbrellaImports", () => {
  it("rewrites the registry's aliased import to a namespace import", () => {
    const { source, packages } = rewriteUmbrellaImports(
      'import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"',
    );
    expect(source).toBe(
      'import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"',
    );
    expect(packages).toEqual(["@radix-ui/react-dropdown-menu"]);
  });

  it("handles a trailing semicolon and single quotes", () => {
    const { source } = rewriteUmbrellaImports(
      "import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';",
    );
    expect(source).toBe(
      'import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"',
    );
  });

  it("handles an un-aliased specifier", () => {
    const { source } = rewriteUmbrellaImports('import { Label } from "radix-ui"');
    expect(source).toBe('import * as Label from "@radix-ui/react-label"');
  });

  it("splits a multi-specifier statement into one import per package", () => {
    const { source, packages } = rewriteUmbrellaImports(
      'import { Dialog as SheetPrimitive, Slot } from "radix-ui"',
    );
    expect(source).toBe(
      [
        'import * as SheetPrimitive from "@radix-ui/react-dialog"',
        'import * as Slot from "@radix-ui/react-slot"',
      ].join("\n"),
    );
    expect(packages).toEqual([
      "@radix-ui/react-dialog",
      "@radix-ui/react-slot",
    ]);
  });

  it("rewrites every occurrence in a file", () => {
    const { packages } = rewriteUmbrellaImports(
      [
        'import { Dialog as DialogPrimitive } from "radix-ui"',
        'import { Label as LabelPrimitive } from "radix-ui"',
      ].join("\n"),
    );
    expect(packages).toEqual([
      "@radix-ui/react-dialog",
      "@radix-ui/react-label",
    ]);
  });

  it("leaves the individual-package import untouched", () => {
    const before =
      'import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"';
    const { source, packages } = rewriteUmbrellaImports(before);
    expect(source).toBe(before);
    expect(packages).toEqual([]);
  });

  it("does not need an X.Root normalisation — member access is left alone", () => {
    // A namespace import of @radix-ui/react-dropdown-menu exposes .Root exactly
    // as the umbrella's namespace does (src/components/ui/dropdown-menu.tsx:17),
    // so rewriting member accesses would be a second regex with nothing to fix.
    const { source } = rewriteUmbrellaImports(
      [
        'import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"',
        "<DropdownMenuPrimitive.Root {...props} />",
      ].join("\n"),
    );
    expect(source).toContain("<DropdownMenuPrimitive.Root {...props} />");
  });
});
