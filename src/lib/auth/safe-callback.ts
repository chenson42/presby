/**
 * Validates that a callbackUrl is a safe same-origin relative reference.
 * Falls back to /launch if the value is absent, malformed, or resolves
 * off-origin.
 *
 * /launch is the single post-authentication target (DECISION-034): it computes
 * the destination from the user's organizations and redirects, so falling back
 * to it is correct for every user rather than for the platform-shell user
 * /home was written for.
 *
 * This is a PURE STRING FUNCTION and must stay one. It does not learn about
 * organization slugs and it imports nothing beyond the platform `URL` global
 * (available in Node and on the Edge runtime, though this module is not
 * currently imported by src/proxy.ts — see the header note in that file). The
 * open-redirect class is handled here and only here; whether a `/o/<slug>`
 * path is one the user can actually enter is a UX question answered by
 * computeDestination(), and the security answer is the independent resolve
 * at /o/<slug> itself.
 *
 * SECURITY (2026-09-25 security review, H-new-1; docs/work-log/
 * 2026-09-25-security-review-highs.md): this used to be a hand-rolled prefix
 * check (`startsWith("/") && !startsWith("//")`), which is really a WHATWG
 * URL-parsing question standing in as a string question. Two bypass classes
 * were found against it: `//`-style protocol-relative URLs (closed
 * 2026-07-11, then this file drifted back to a narrower check), and a
 * backslash prefix (`/\evil.example`) — the WHATWG spec treats a backslash
 * the same as a forward slash for every "special" scheme, so a browser (and
 * Node's own URL parser) resolves that as an absolute authority, not a
 * relative path. A THIRD class survives even the security review's own
 * draft patch (`raw.includes("\\")`): the parser strips embedded ASCII
 * tab/newline/CR from the *entire* input before applying any other rule, so
 * `"/\t\t/evil.example"` collapses to `"//evil.example"` and resolves
 * off-origin even though it contains no backslash at all. Pattern-matching
 * has now been bypassed twice; the fix is to stop enumerating string shapes
 * and ask the same parser a browser uses.
 *
 * SECURITY (2026-09-25 Phase 5 QA loop-back on the fix above; same work-log):
 * a FOURTH class survived even the parser-based fix, because the fix asked
 * the parser about the *input* and returned the *output* unchecked. WHATWG
 * dot-segment normalization (removing "." and ".." path segments) happens
 * as part of the same parse that computes `.origin` — so an input like
 * `"/.//evil.example"` or `"/..//evil.example"` parses with
 * `origin === SAFE_BASE_ORIGIN` (the dot segments are consumed before origin
 * is computed) while the resulting *pathname* is exactly `"//evil.example"`,
 * a protocol-relative string that a caller's `redirect()` re-resolves off-
 * origin the moment a browser sees it. The lesson generalizes: a sanitizer's
 * postcondition must be asserted on its OUTPUT, not inferred from a check
 * performed on its INPUT — the input-side check answered a true fact
 * ("this parses same-origin") that no longer implied the property the
 * caller actually depends on ("this string, handed to `redirect()`, stays
 * same-origin"). See the postcondition block at the end of the function.
 */

// Fixed, unroutable base. An attacker-controlled `raw` can never make a
// relative reference resolve TO this origin, so comparing the parsed result
// against it is a safe same-origin test for every relative form.
const SAFE_BASE_ORIGIN = "https://internal.invalid";

/**
 * The app's real origin, resolved once at module load from the same env var
 * (falling back to the same local-dev default) every other server-rendered
 * page in this codebase already uses to build an absolute URL — see
 * src/app/(account)/account/actions.ts, src/app/(password-reset)/actions.ts,
 * src/lib/email/send.ts. Comparing against the real origin (in addition to
 * the fixed base above) means a legitimate absolute same-origin URL is
 * accepted rather than silently downgraded to /launch, without reintroducing
 * any way for attacker-controlled input to reach that branch (it is never
 * derived from `raw`).
 */
function resolveAppOrigin(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000")
      .origin;
  } catch {
    return null;
  }
}

const APP_ORIGIN = resolveAppOrigin();

export function sanitizeCallbackUrl(raw: string | undefined | null): string {
  if (typeof raw !== "string" || raw.length === 0) return "/launch";

  // Belt-and-braces ahead of the parser: reject embedded ASCII control
  // characters (0x00-0x1F, 0x7F) outright. The WHATWG parser already strips
  // tab/newline/CR before doing anything else — relying on that stripping
  // behavior to be caught by the .origin comparison below is correct (and is
  // exactly what the embedded-tab regression test proves), but an explicit
  // reject here means a *future* parser quirk in a character class we
  // haven't enumerated fails closed instead of depending on parser behavior
  // that would have to be re-verified by hand every time. Cheap, and it
  // costs nothing a legitimate `next=`/`callbackUrl=` value would ever trip.
  if (/[\x00-\x1f\x7f]/.test(raw)) return "/launch";

  let parsed: URL;
  try {
    parsed = new URL(raw, SAFE_BASE_ORIGIN);
  } catch {
    return "/launch";
  }

  // A schemeless, slash-less candidate (e.g. "evil.example/steal") parses
  // against the fixed base as a same-origin PATH, not an authority — it is
  // not an open-redirect vector, but it is also not the shape this
  // function's contract has ever accepted ("/"-rooted relative path, or an
  // absolute URL matching the app's real origin). Requiring the literal
  // input to be rooted (single leading "/", not "//") before trusting the
  // fixed-base comparison preserves that contract exactly, while the origin
  // comparison itself (not a prefix check) is what actually closes the
  // backslash/control-character bypass classes above.
  const isRootedPath = raw.startsWith("/") && !raw.startsWith("//");
  const sameOriginAsFixedBase =
    isRootedPath && parsed.origin === SAFE_BASE_ORIGIN;
  const sameOriginAsRealApp =
    APP_ORIGIN !== null && parsed.origin === APP_ORIGIN;
  if (!sameOriginAsFixedBase && !sameOriginAsRealApp) return "/launch";

  // Always return the normalized parse, never the raw string, even when
  // they are textually identical. The entire point of routing `raw` through
  // `URL` is that the parser is the thing we trust; returning the pre-parse
  // string re-introduces exactly the "what does a browser do with this
  // text" question the parser was supposed to answer once and for all.
  const result = `${parsed.pathname}${parsed.search}${parsed.hash}`;

  // POSTCONDITION — asserted on the OUTPUT, not the input. A sanitizer's
  // contract is what it returns, not which pattern the input did or didn't
  // match (QA finding, 2026-09-25 Phase 5 loop-back;
  // docs/work-log/2026-09-25-security-review-highs.md). WHATWG dot-segment
  // normalization can turn an input that parses SAME-ORIGIN above into an
  // OUTPUT that is protocol-relative: "/.//evil.example" and
  // "/..//evil.example" both satisfy `parsed.origin === SAFE_BASE_ORIGIN`
  // (the "." / ".." segments are consumed by normalization before origin is
  // computed — RFC 3986 / WHATWG remove_dot_segments), yet the resulting
  // pathname is exactly "//evil.example". A caller's `redirect()` re-resolves
  // that STRING against the current document, where a leading "//" is
  // protocol-relative and escapes the origin entirely — confirmed live,
  // `GET /launch?next=%2F.%2F%2Fevil.example` → `307 location: //evil.example`
  // at HEAD before this fix. `isRootedPath` above inspects `raw`, which never
  // contains a literal "//" prefix in these payloads — the danger is
  // manufactured BY normalization, so only the returned string can catch it.
  // Re-parsing `result` against the fixed base and re-checking `.origin` is
  // the "ask the parser, not the pattern" principle applied a second time, now
  // to the far end of the pipe (the round-trip is the real check); the
  // explicit `startsWith` guards are belt-and-braces on top of that, not a
  // substitute for it — a defense against a future parser or caller-side
  // resolution quirk this exact round-trip doesn't happen to model.
  let resultIsSafe: boolean;
  try {
    resultIsSafe =
      new URL(result, SAFE_BASE_ORIGIN).origin === SAFE_BASE_ORIGIN &&
      !result.startsWith("//") &&
      !result.startsWith("/\\");
  } catch {
    resultIsSafe = false;
  }
  if (!resultIsSafe) return "/launch";

  return result;
}
