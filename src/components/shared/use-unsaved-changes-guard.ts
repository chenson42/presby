"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * H3 (docs/reviews/2026-08-26-portal-ux.md) — the reusable mechanism behind
 * every guarded form in this batch (`docs/ui-standards.md` § Forms —
 * Unsaved Changes Guard). The documented recipe there is `isDirty` +
 * `discardOpen`/`pendingHref` state + an explicit Back/Cancel click handler;
 * this hook packages exactly that state machine so six call sites don't
 * hand-roll it six times, plus two additions the recipe itself doesn't cover
 * but this batch's brief asked for:
 *
 * 1. `beforeunload` — covers a hard navigation (typed URL, refresh) or tab
 *    close, which a client-side `router.push` interception can never see.
 * 2. A document-level, capture-phase click listener on same-origin `<a>`
 *    elements — covers an in-app `<Link>` the guarded form did not itself
 *    render (the admin shell's "Back to portal" link one layout up, or a
 *    "Back to roles"/"Back to X" link a server-rendered `page.tsx` puts
 *    ABOVE the client form). Dependency-free: no router-events API exists in
 *    the App Router to hook into, so this walks the clicked element's
 *    ancestor chain for the nearest `<a href>` (which is exactly what a
 *    `next/link` renders), skips anything that isn't a plain same-origin
 *    left-click navigation (modifier keys, middle-click, `target=_blank`,
 *    `download`, `#`/`mailto:`/`tel:` links, or a different origin all pass
 *    through untouched), and re-issues the navigation itself via
 *    `router.push()` only after the user confirms the discard. This only
 *    ever runs while `isDirty` is true — a clean form adds no listener and
 *    intercepts nothing.
 *
 * Callers who ALSO have an explicit in-form Back/Cancel affordance (a
 * `<button>`, not a `<Link>`, per the documented recipe) call
 * `guardedNavigate(href)` from that button's `onClick` instead of
 * `router.push(href)` directly — same dirty-check, same dialog, no second
 * code path.
 */
export interface UnsavedChangesGuard {
  /** Whether the discard-confirmation `AlertDialog` is open. */
  discardOpen: boolean;
  setDiscardOpen: (open: boolean) => void;
  /** Navigate to `href`, opening the discard dialog first if dirty. */
  guardedNavigate: (href: string) => void;
  /** Called by the dialog's "Discard" action — closes the dialog and
   * completes whichever navigation (explicit or intercepted) was pending. */
  confirmDiscard: () => void;
}

export function useUnsavedChangesGuard(isDirty: boolean): UnsavedChangesGuard {
  const router = useRouter();
  const [discardOpen, setDiscardOpen] = useState(false);
  const pendingHrefRef = useRef<string | null>(null);

  // Read inside the effects via a ref so neither listener needs to be torn
  // down and re-added on every dirty/clean flip — only the guard clauses at
  // the top of each handler change behavior. The write happens in its own
  // effect, not inline during render — a ref mutated during render is
  // impure and React's own eslint rule (react-hooks/refs) flags it.
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      // Chrome requires `returnValue` to be set for the native prompt to
      // appear; the string itself is never shown by a modern browser.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!isDirtyRef.current) return;
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!anchor) return;
      if (anchor.getAttribute("target") === "_blank") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
      ) {
        return;
      }

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      e.preventDefault();
      e.stopPropagation();
      pendingHrefRef.current = `${url.pathname}${url.search}${url.hash}`;
      setDiscardOpen(true);
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  const guardedNavigate = useCallback(
    (href: string) => {
      if (isDirtyRef.current) {
        pendingHrefRef.current = href;
        setDiscardOpen(true);
      } else {
        router.push(href);
      }
    },
    [router],
  );

  const confirmDiscard = useCallback(() => {
    setDiscardOpen(false);
    const href = pendingHrefRef.current;
    pendingHrefRef.current = null;
    if (href) {
      router.push(href);
    }
  }, [router]);

  return { discardOpen, setDiscardOpen, guardedNavigate, confirmDiscard };
}
