"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrgMark } from "@/components/brand/org-mark";
import { BrandPreviewSwatch } from "@/components/brand/brand-preview-swatch";
import { generateBrandTokens } from "@/lib/brand/generate";
import { TYPE_PAIRINGS, type TypePairingKey } from "@/lib/brand/contract";
import { setOrganizationBrandAction, type PolicyResult } from "./actions";

const SEED_HEX_RE = /^#[0-9a-fA-F]{6}$/;

// A blue-600 starting point for an organization with no brand yet, matching
// this repo's own un-rebranded accent (CLAUDE.md → Visual Style). Not a
// suggestion of what the org's colour "should" be — it just has to start
// somewhere the colour picker can open to, and this is the one every fork
// already ships with.
const DEFAULT_SEED_HEX = "#2563eb";

interface BrandFormProps {
  organizationId: string;
  organizationName: string;
  initialSeedHex: string | null;
  initialTypePairing: TypePairingKey;
  initialMarkSrc: string | null;
  initialLightOnly: boolean;
}

/** E-c2: the server's partial-success phrasing, matched verbatim so the UI
 * can tell "the colour saved, only the logo failed" apart from a total
 * failure — same string `[id]/actions.ts` returns, quoted there too. */
const PARTIAL_SAVE_PREFIX = "Colour and type pairing saved.";

async function submitBrand(
  _prev: PolicyResult | null,
  formData: FormData,
): Promise<PolicyResult> {
  return setOrganizationBrandAction(formData);
}

export function BrandForm({
  organizationId,
  organizationName,
  initialSeedHex,
  initialTypePairing,
  initialMarkSrc,
  initialLightOnly,
}: BrandFormProps) {
  const [seedHex, setSeedHex] = useState(initialSeedHex ?? DEFAULT_SEED_HEX);
  const [typePairing, setTypePairing] = useState<TypePairingKey>(
    initialTypePairing,
  );
  const [lightOnly, setLightOnly] = useState(initialLightOnly);
  const [result, formAction, isPending] = useActionState(
    submitBrand,
    null as PolicyResult | null,
  );

  const isValidHex = SEED_HEX_RE.test(seedHex);

  // Re-derived CLIENT-SIDE on every hex/pairing change for the live preview —
  // zero server round-trip. Safe: generate.ts is explicitly not server-only
  // (see its own header, and contrast.ts's "the brand editor's preview
  // evaluates the same floors in the browser").
  const generated = useMemo(() => {
    if (!isValidHex) return null;
    try {
      return generateBrandTokens(seedHex);
    } catch {
      return null;
    }
  }, [seedHex, isValidHex]);

  const selectedPairing = TYPE_PAIRINGS.find((p) => p.key === typePairing);

  const isPartialSave =
    result?.ok === false && result.error.startsWith(PARTIAL_SAVE_PREFIX);

  // Toast is a SUPPLEMENT here, not the record — the inline banner below is
  // what E-c1/E-c2 require to persist ("never a toast that vanishes"). The
  // three outcomes get three different toast calls so a partial save is not
  // visually identical to a total failure.
  useEffect(() => {
    if (!result) return;
    if (result.ok) {
      toast.success("Brand saved.");
    } else if (isPartialSave) {
      toast.warning(result.error);
    } else {
      toast.error(result.error);
    }
  }, [result, isPartialSave]);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form action={formAction} className="space-y-6">
        <input type="hidden" name="organizationId" value={organizationId} />

        {result && (
          <div
            role="status"
            className={
              result.ok
                ? "rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
                : isPartialSave
                  ? "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                  : "rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
            }
          >
            {result.ok ? "Brand saved." : result.error}
          </div>
        )}

        {/* Door 1 — pick a colour, or door 2 — enter a hex code (G10). The
            native colour picker and the text field share one piece of
            state; only the text field carries `name`, so exactly one value
            is submitted. */}
        <div>
          <Label htmlFor="seedHex">Brand colour</Label>
          <div className="mt-1 flex items-center gap-3">
            <input
              id="seedHexPicker"
              type="color"
              aria-label="Pick a colour to fill the hex code field"
              value={isValidHex ? seedHex.toLowerCase() : DEFAULT_SEED_HEX}
              onChange={(e) => setSeedHex(e.target.value)}
              className="size-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
            />
            <Input
              id="seedHex"
              name="seedHex"
              type="text"
              value={seedHex}
              onChange={(e) => setSeedHex(e.target.value.trim())}
              placeholder="#7a1f2b"
              className="max-w-40 font-mono"
              aria-describedby="seedHexHelp"
            />
          </div>
          <p id="seedHexHelp" className="mt-1.5 text-xs text-muted-foreground">
            {isValidHex
              ? "Read this off a letterhead, a bulletin, or pick with the swatch."
              : "Enter a colour as a 6-digit hex code, like #7a1f2b."}
          </p>
        </div>

        <div>
          <Label htmlFor="typePairing">Type pairing</Label>
          {/* Native <select>, not a shadcn Select: slice a's Phase 3 design
              ruled against generating one — no consumer existed in the tree
              (docs/work-log/2026-08-19-brand-foundation.md, "Which primitives
              to generate"), and this is a plain three-option filter. */}
          <div className="relative mt-1">
            <select
              id="typePairing"
              name="typePairing"
              value={typePairing}
              onChange={(e) =>
                setTypePairing(e.target.value as TypePairingKey)
              }
              className="h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 pr-8 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {TYPE_PAIRINGS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
          {selectedPairing && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {selectedPairing.why}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2">
            <input
              id="lightOnly"
              name="lightOnly"
              type="checkbox"
              checked={lightOnly}
              onChange={(e) => setLightOnly(e.target.checked)}
              className="size-4 rounded border-input"
            />
            <Label htmlFor="lightOnly" className="cursor-pointer font-normal">
              Light mode only
            </Label>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            This organization&apos;s brand was never designed against a dark
            background — its public site and member portal always render
            light, regardless of a visitor&apos;s system preference.
          </p>
        </div>

        {/* Door 3 — upload the logo (G10). Wordmark upload is not wired in
            this minimal operator surface — see actions.ts's own note; the
            column is reserved for slice d. */}
        <div>
          <Label htmlFor="logo">Logo (optional)</Label>
          <div className="mt-1 flex items-center gap-3">
            <OrgMark name={organizationName} markSrc={initialMarkSrc} />
            <Input
              id="logo"
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="max-w-xs"
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            PNG, JPEG, or WEBP, up to 2 MB. Sits on its own neutral plate
            everywhere it&apos;s shown — never composited onto the brand
            colour.
          </p>
        </div>

        {/* Flow 3: a non-empty adjustments[] renders here, unconditionally,
            BEFORE the Save button — never behind a disclosure, never an
            "accept the risk" opt-out (G2 forbids one). */}
        {generated && generated.adjustments.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Before you save
            </p>
            <ul className="mt-2 space-y-2 text-sm text-amber-800 dark:text-amber-300">
              {generated.adjustments.map((a, i) => (
                <li key={`${a.role}-${a.scheme}-${i}`}>{a.message}</li>
              ))}
            </ul>
          </div>
        )}

        <Button type="submit" disabled={isPending || !isValidHex}>
          {isPending ? "Saving…" : "Save brand"}
        </Button>
      </form>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Live preview
        </h2>
        {generated ? (
          <div className="space-y-4">
            <BrandPreviewSwatch
              tokens={generated.tokens.light}
              scheme="light"
              organizationName={organizationName}
            />
            <BrandPreviewSwatch
              tokens={generated.tokens.dark}
              scheme="dark"
              organizationName={organizationName}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Enter a valid colour to see a preview.
          </p>
        )}
      </div>
    </div>
  );
}
