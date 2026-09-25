import { describe, it, expect } from "vitest";
import { sanitizeCallbackUrl } from "./safe-callback";

describe("sanitizeCallbackUrl", () => {
  it("passes through a valid relative path", () => {
    expect(sanitizeCallbackUrl("/foo")).toBe("/foo");
  });

  it("passes through a nested valid relative path", () => {
    expect(sanitizeCallbackUrl("/admin/users")).toBe("/admin/users");
  });

  it("passes through an org path untouched — it knows nothing about slugs", () => {
    // Deliberate: this function is a pure string check. Whether the user can
    // enter /o/alder-creek is computeDestination's question, and the gate is
    // the independent resolve at /o/<slug>.
    expect(sanitizeCallbackUrl("/o/alder-creek")).toBe("/o/alder-creek");
  });

  it("passes through a relative path with a query string and fragment", () => {
    // Phase 1 flagged this shape (query + fragment together) as previously
    // untested. The normalized return re-assembles pathname + search + hash,
    // which must round-trip byte-identical for an already-safe path with no
    // characters the parser would rewrite.
    expect(sanitizeCallbackUrl("/o/alder-creek?tab=roll#row-3")).toBe(
      "/o/alder-creek?tab=roll#row-3",
    );
  });

  it("passes through a percent-encoded path segment, parser-normalized", () => {
    expect(sanitizeCallbackUrl("/o/alder%2Dcreek")).toBe("/o/alder%2Dcreek");
  });

  it("rejects a protocol-relative URL (//evil.com) and returns /launch", () => {
    expect(sanitizeCallbackUrl("//evil.com")).toBe("/launch");
  });

  it("rejects an absolute http URL and returns /launch", () => {
    expect(sanitizeCallbackUrl("https://evil.com/steal")).toBe("/launch");
  });

  it("rejects a non-slash-prefixed string and returns /launch", () => {
    expect(sanitizeCallbackUrl("evil.com/steal")).toBe("/launch");
  });

  it("rejects a javascript: URI and returns /launch", () => {
    expect(sanitizeCallbackUrl("javascript:alert(1)")).toBe("/launch");
  });

  it("rejects a data: URI and returns /launch", () => {
    expect(sanitizeCallbackUrl("data:text/html,<script>alert(1)</script>")).toBe(
      "/launch",
    );
  });

  it("returns /launch for null", () => {
    expect(sanitizeCallbackUrl(null)).toBe("/launch");
  });

  it("returns /launch for undefined", () => {
    expect(sanitizeCallbackUrl(undefined)).toBe("/launch");
  });

  it("returns /launch for an empty string", () => {
    expect(sanitizeCallbackUrl("")).toBe("/launch");
  });

  it("returns /launch for a non-string value (defensive against a malformed searchParams read)", () => {
    // The declared type is `string | undefined | null`, but a caller reading
    // a malformed `searchParams` entry could hand this an array. Belt and
    // braces per Phase 3's edge-case note.
    expect(
      sanitizeCallbackUrl(["/foo"] as unknown as string),
    ).toBe("/launch");
  });

  describe("backslash and control-character bypasses (H-new-1, 2026-09-25 regression)", () => {
    // The review's own draft patch (`raw.startsWith("/") && !raw.startsWith("//")
    // && !raw.includes("\\")`) is necessary but not sufficient — see the
    // work-log's Implementer Notes for the failing-first proof run against
    // that draft before this fix was written. Every case below must resolve
    // to /launch under the PARSER-based fix, not a pattern match.

    it("rejects a leading-backslash form (/\\evil.example)", () => {
      expect(sanitizeCallbackUrl("/\\evil.example")).toBe("/launch");
    });

    it("rejects a backslash-first form with no leading slash (\\/evil.example)", () => {
      expect(sanitizeCallbackUrl("\\/evil.example")).toBe("/launch");
    });

    it("rejects a double-backslash form (/\\\\evil.example)", () => {
      expect(sanitizeCallbackUrl("/\\\\evil.example")).toBe("/launch");
    });

    it("rejects an alternating slash/backslash form (/\\/\\evil.example)", () => {
      expect(sanitizeCallbackUrl("/\\/\\evil.example")).toBe("/launch");
    });

    it("rejects a scheme-relative backslash form (https:/\\evil.example)", () => {
      expect(sanitizeCallbackUrl("https:/\\evil.example")).toBe("/launch");
    });

    it("rejects an embedded-tab form that collapses to // under the WHATWG parser — the class the review's own draft patch misses", () => {
      // new URL("/\t\t/evil.example", base) strips the tabs BEFORE parsing,
      // collapsing this to "//evil.example" and resolving off-origin. No
      // backslash appears anywhere in the input, so `raw.includes("\\")`
      // (the review's draft) does not and cannot catch this — only asking
      // the same parser a browser uses does.
      expect(sanitizeCallbackUrl("/\t\t/evil.example")).toBe("/launch");
    });

    it("rejects an embedded-newline form, same collapse-to-// class", () => {
      expect(sanitizeCallbackUrl("/\n/evil.example")).toBe("/launch");
    });

    it("rejects an embedded-carriage-return form, same collapse-to-// class", () => {
      expect(sanitizeCallbackUrl("/\r/evil.example")).toBe("/launch");
    });

    it("passes through an encoded-slash form unchanged — guards against an over-broad textual fix", () => {
      // A percent-encoded slash in the path is inert to the URL parser (it
      // is never decoded back into a path separator), so this is a
      // same-origin path, not an open redirect, and must not be rejected by
      // a fix that over-broadly bans "%2F"-looking text.
      expect(sanitizeCallbackUrl("/%2F%2Fevil.example")).toBe(
        "/%2F%2Fevil.example",
      );
    });

    it("passes through an encoded-backslash form unchanged — guards against an over-broad textual fix", () => {
      expect(sanitizeCallbackUrl("/%5Cevil.example")).toBe("/%5Cevil.example");
    });

    it("passes through a fullwidth-solidus form unchanged (parser-normalized, still inert) — guards against an over-broad textual fix", () => {
      // U+FF0F (fullwidth solidus) is not the ASCII "/" the WHATWG parser
      // treats specially; it is percent-encoded as literal path text, same
      // origin, never rejected.
      expect(sanitizeCallbackUrl("/／／evil.example")).toBe(
        "/%EF%BC%8F%EF%BC%8Fevil.example",
      );
    });
  });

  describe("dot-segment normalization producing a protocol-relative OUTPUT (H-new-1 Phase 5 loop-back regression, 2026-09-25)", () => {
    // QA reproduced this live against the Phase 4 fix: the parser-based check
    // above asks whether the PARSED INPUT is same-origin, which it is — the
    // "." / ".." segments are consumed by WHATWG dot-segment normalization
    // before `.origin` is computed — but the RETURNED STRING is left
    // unchecked, and normalization can turn that same-origin input into a
    // protocol-relative output ("//evil.example") that a caller's
    // `redirect()` re-resolves off-origin. See old-sanitize.mjs (deleted, not
    // committed) for the failing-first proof against the Phase 4 code, run
    // before this test block was written:
    //   "/.//evil.example"                    -> got "//evil.example" (FAIL)
    //   "/..//evil.example"                   -> got "//evil.example" (FAIL)
    //   "/a/..//evil.example"                 -> got "//evil.example" (FAIL)
    //   "/%2e//evil.example"                  -> got "//evil.example" (FAIL)
    //   "/.//evil.example?x=1#f"              -> got "//evil.example?x=1#f" (FAIL)
    //   "http://localhost:3000/.//evil.example" -> got "//evil.example" (FAIL)
    // Every case below must resolve to /launch under the postcondition fix.

    it("rejects a single-dot-segment form (/.//evil.example)", () => {
      expect(sanitizeCallbackUrl("/.//evil.example")).toBe("/launch");
    });

    it("rejects a double-dot-segment form (/..//evil.example)", () => {
      expect(sanitizeCallbackUrl("/..//evil.example")).toBe("/launch");
    });

    it("rejects a repeated-single-dot form (/././/evil.example)", () => {
      expect(sanitizeCallbackUrl("/././/evil.example")).toBe("/launch");
    });

    it("rejects a dot-segment form preceded by a real path component (/a/..//evil.example)", () => {
      expect(sanitizeCallbackUrl("/a/..//evil.example")).toBe("/launch");
    });

    it("rejects a percent-encoded single-dot-segment form (/%2e//evil.example)", () => {
      expect(sanitizeCallbackUrl("/%2e//evil.example")).toBe("/launch");
    });

    it("rejects a percent-encoded double-dot-segment form (/%2E%2E//evil.example)", () => {
      expect(sanitizeCallbackUrl("/%2E%2E//evil.example")).toBe("/launch");
    });

    it("rejects a dot-segment form carrying a query string and fragment", () => {
      expect(sanitizeCallbackUrl("/.//evil.example?x=1#f")).toBe("/launch");
    });

    it("rejects a dot-segment form reached via the absolute-same-origin-app branch", () => {
      // NEXT_PUBLIC_APP_URL is unset in the test environment, so the
      // absolute-URL branch resolves against the same localhost:3000
      // fallback every other test in this file relies on — this proves the
      // postcondition check applies uniformly to both acceptance branches,
      // not only the fixed-base one.
      expect(
        sanitizeCallbackUrl("http://localhost:3000/.//evil.example"),
      ).toBe("/launch");
    });

    it("invariant: no returned value ever starts with // or /\\, across the full hostile matrix", () => {
      const hostileMatrix = [
        "//evil.example",
        "https://evil.example/steal",
        "evil.example/steal",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "/\\evil.example",
        "\\/evil.example",
        "/\\\\evil.example",
        "/\\/\\evil.example",
        "https:/\\evil.example",
        "/\t\t/evil.example",
        "/\n/evil.example",
        "/\r/evil.example",
        "/.//evil.example",
        "/..//evil.example",
        "/././/evil.example",
        "/a/..//evil.example",
        "/%2e//evil.example",
        "/%2E%2E//evil.example",
        "/.//evil.example?x=1#f",
        "http://localhost:3000/.//evil.example",
      ];
      for (const raw of hostileMatrix) {
        const result = sanitizeCallbackUrl(raw);
        expect(result.startsWith("//")).toBe(false);
        expect(result.startsWith("/\\")).toBe(false);
      }
    });
  });

  describe("absolute same-origin acceptance (Phase 3 edge case)", () => {
    // NEXT_PUBLIC_APP_URL is unset in the test environment, so the module's
    // real-app-origin fallback is the same "http://localhost:3000" default
    // every other server-rendered page in this codebase already uses.
    it("accepts an absolute URL matching the app's real origin, normalized to a relative path", () => {
      expect(sanitizeCallbackUrl("http://localhost:3000/admin")).toBe(
        "/admin",
      );
    });

    it("rejects an absolute URL on a foreign origin even if it looks path-similar", () => {
      expect(sanitizeCallbackUrl("https://evil.example/admin")).toBe(
        "/launch",
      );
    });
  });
});
