import Link from "next/link";
import { signIn } from "@/auth";
import { sanitizeCallbackUrl } from "@/lib/auth/safe-callback";
import { isLocalLoginEnabled } from "@/lib/auth/local-login";
import { isFlagEnabled } from "@/lib/flags";
import { getPublishedSiteBrand } from "@/lib/sites";
import { BrandTokens } from "@/components/brand/brand-tokens";
import { OrgWordmark } from "@/components/brand/org-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SignInCredentialsForm } from "./signin-credentials-form";
import { parseOrgSlugFromCallbackUrl } from "./parse-org-slug";

/**
 * `/signin` — the THIRD `<BrandTokens>` emitter (DECISION-047's amendment;
 * `scripts/check-brand-scope.mjs`'s `EMITTERS[2]`). A single page, not a
 * route-group layout: `(auth)` also hosts `/totp`, `/forgot-password`, and
 * `/reset-password`, which stay platform-chrome in this increment (Phase 2 —
 * a layout can't see which child page is rendering, the same reason the
 * `(org)` contract puts its auth check in the page, not the layout).
 *
 * The brand is a function of the URL's slug alone, never of who ends up
 * signing in — a visitor who clicks "Member Login" on Alder Creek's site
 * sees Alder Creek's chrome regardless of which account they authenticate
 * with. `parseOrgSlugFromCallbackUrl()` runs only on the OUTPUT of
 * `sanitizeCallbackUrl()`, never on raw `searchParams` — the open-redirect
 * class stays exactly where `safe-callback.ts` already handles it.
 *
 * Any failure — no callbackUrl slug, `ui.branded_signin` off,
 * `getPublishedSiteBrand()` returning `null` for any reason (bad slug, DB
 * blip, no brand row, `sites.public_render`/`ui.brand_theming` off) — leaves
 * `siteBrand` at `null` and renders byte-identical platform-default chrome.
 * Branding never blocks or slows sign-in.
 *
 * Phase 6 rework (2026-08-24): the Google sign-in `<form>` below carries
 * `data-brand-neutral` — without it, `<BrandTokens>` re-declaring `--primary`
 * at page scope repaints the stock shadcn `<Button>`'s `bg-primary`, which is
 * exactly the recolor the design forbids. The credentials form's own submit
 * button is NOT wrapped and is allowed to carry the brand.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const callbackUrl = sanitizeCallbackUrl(sp.callbackUrl);
  // isLocalLoginEnabled() is fail-open — returns true on DB error or missing
  // row, so this read never causes a 500 on the sign-in page.
  const localLoginEnabled = await isLocalLoginEnabled();

  const orgSlug = parseOrgSlugFromCallbackUrl(callbackUrl);
  // ui.branded_signin checked bare — a cosmetic toggle, not an auth path, so
  // isFlagEnabled()'s "false on missing row or DB error" default is already
  // the safe direction (platform chrome) and needs no DECISION-026 fail-open
  // wrapper (Phase 1/3).
  const siteBrand =
    orgSlug && (await isFlagEnabled("ui.branded_signin"))
      ? await getPublishedSiteBrand(orgSlug)
      : null;

  return (
    <main
      className={cn(
        "mx-auto max-w-sm px-6 py-24",
        siteBrand?.brand?.fontPairing.bodyClassName,
      )}
    >
      <BrandTokens
        brand={siteBrand?.brand?.tokens ?? null}
        lightOnly={siteBrand?.brand?.lightOnly ?? false}
      />
      {siteBrand && orgSlug && (
        // Unboxed and linked back to the public site — same treatment as
        // GlobalNav's own header wordmark (2026-08-26 portal-chrome
        // refinement: "the logo doesn't need to be in a card"). `OrgMark`'s
        // fixed neutral plate (G7) is right for a small header lockup
        // sitting next to other chrome; here the logo IS the page's own
        // identity, so it renders at its natural size with no card around it.
        <Link
          href={`/site/${orgSlug}`}
          className="mb-4 inline-block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={`${siteBrand.organizationName} public site`}
        >
          <OrgWordmark
            name={siteBrand.organizationName}
            markSrc={siteBrand.logoUrl}
            plate={false}
          />
        </Link>
      )}
      <h1
        className={cn(
          "text-2xl font-semibold",
          siteBrand?.brand?.fontPairing.headingClassName,
        )}
      >
        Sign in
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Sign in to your account.
      </p>

      {sp.error === "deactivated" && (
        <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
          This account has been deactivated. Contact an administrator.
        </p>
      )}
      {sp.error === "CredentialsSignin" && (
        <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
          Wrong email or password.
        </p>
      )}

      {/*
        data-brand-neutral: the Google button is never recolored (Phase 1
        Gap, Phase 3 design — "brand wraps the form, never restyles it";
        Google's own brand guidelines forbid recoloring their button). The
        credentials form's submit button below is deliberately NOT wrapped —
        it is allowed to carry the org brand, matching the public site's own
        look. See src/components/brand/brand-tokens.tsx's
        `[data-brand-neutral]` doc comment for the mechanism.
      */}
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: callbackUrl });
        }}
        className="mt-6"
        data-brand-neutral=""
      >
        <Button type="submit" className="w-full">
          Sign in with Google
        </Button>
      </form>

      {localLoginEnabled && (
        <>
          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <SignInCredentialsForm callbackUrl={callbackUrl} />

          <p className="mt-4 text-xs text-muted-foreground">
            First time? Run <code>npm run db:seed</code> to provision the
            seeded admin user.
          </p>
        </>
      )}
    </main>
  );
}
