/**
 * invitation-observer.ts - the in-page probes the invitation specs share
 * (Phase 2 addendum 2, "The test that pins it").
 *
 * THE DEAD-LINK FLASH. A server-action redirect renders its target inside the
 * action's own POST, so a hand-off cookie that is not `Path=/` is missing from
 * the render of `/invite` that follows sign-in. The invitee then sees "This link
 * isn't active" for a moment (or until a reload), with a live invitation behind
 * it. A polling assertion cannot catch a flash that a refresh repairs within a
 * second, so a `MutationObserver` is installed BEFORE any page script runs
 * (`page.addInitScript`) and records, in `window.__deadSeen` AND
 * `sessionStorage.__deadSeen` (a full navigation resets `window`), if an `<h1>`
 * containing the dead-link phrase is EVER added or rewritten. It inspects the
 * added nodes themselves, not only the document afterwards, so a node inserted
 * and removed inside one task is still seen.
 */
import type { BrowserContext, Page } from "@playwright/test";

export const DEAD_LINK_PHRASE = "This link isn't active";

/** Install before the first `page.goto`. */
export async function installDeadLinkObserver(page: Page): Promise<void> {
  await page.addInitScript((phrase: string) => {
    const normalize = (text: string | null) => (text ?? "").replace(/[‘’]/g, "'");
    const mark = () => {
      (window as unknown as { __deadSeen?: boolean }).__deadSeen = true;
      try {
        sessionStorage.setItem("__deadSeen", "1");
      } catch {
        /* storage unavailable: window flag still set */
      }
    };
    const hasDeadHeading = (node: Node): boolean => {
      if (node.nodeType === Node.TEXT_NODE) {
        return normalize(node.textContent).includes(phrase) && node.parentElement?.tagName === "H1";
      }
      if (!(node instanceof Element)) return false;
      if (node.tagName === "H1" && normalize(node.textContent).includes(phrase)) return true;
      return Array.from(node.querySelectorAll("h1")).some((h) => normalize(h.textContent).includes(phrase));
    };
    const scanDocument = () => {
      if (Array.from(document.querySelectorAll("h1")).some((h) => normalize(h.textContent).includes(phrase))) {
        mark();
      }
    };
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData" && hasDeadHeading(record.target)) mark();
        if (record.type === "childList") {
          for (const added of Array.from(record.addedNodes)) if (hasDeadHeading(added)) mark();
          if (record.target instanceof Element && record.target.tagName === "H1" && hasDeadHeading(record.target)) mark();
        }
      }
      scanDocument();
    }).observe(document, { childList: true, subtree: true, characterData: true });
    document.addEventListener("DOMContentLoaded", scanDocument);
  }, DEAD_LINK_PHRASE);
}

/** Whether the dead-link heading was ever present in this page's lifetime or its tab's navigations. */
export async function deadLinkEverSeen(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as unknown as { __deadSeen?: boolean }).__deadSeen === true ||
      sessionStorage.getItem("__deadSeen") === "1",
  );
}

/**
 * Collects the URL of every request the page makes AFTER `start()` is called,
 * plus any POST body, so a spec can prove the token never travelled past the
 * invitation link itself (a URL, a `callbackUrl`, a sign-in form body).
 */
export function collectRequests(page: Page) {
  const urls: string[] = [];
  const bodies: string[] = [];
  let on = false;
  page.on("request", (request) => {
    if (!on) return;
    urls.push(request.url());
    const body = request.postData();
    if (body) bodies.push(body);
  });
  return {
    start: () => {
      on = true;
    },
    urls,
    bodies,
  };
}

/** The hand-off cookie the page set, as the browser stores it, or undefined. */
export async function inviteCookie(context: BrowserContext) {
  const jar = await context.cookies();
  return jar.find((c) => c.name === "invite_token" || c.name === "__Host-invite_token");
}
