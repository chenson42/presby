import type { HelpEntry } from "./types";

/**
 * Which links a help page may carry (R4, H6). The renderer's resolveLink and check:help use
 * this one function, so what the check admits is exactly what renders as an anchor.
 */

/**
 * The only absolute URLs help may link: the project's public repository and its public
 * architecture overview, both already on the marketing home page. Compared on origin + path
 * (trailing slash ignored); a query, a fragment or credentials is refused.
 */
export const EXTERNAL_LINK_ALLOWLIST: readonly string[] = [
  "https://github.com/chenson42/presby",
  "https://chenson42.github.io/presby",
];

export interface ResolvedLink {
  /** "email" is a mailto: link: same tab, no new-window cue. Only the privacy contact address qualifies. */
  kind: "internal" | "external" | "email";
  href: string;
}

export interface LinkContext {
  /** Published slug -> the anchors it declares. */
  published: ReadonlyMap<string, readonly string[]>;
  pending: ReadonlyMap<string, readonly string[]>;
  planned: ReadonlySet<string>;
  /** The build-time privacy contact address (env.ts), or null. The one mailto: help may carry. */
  privacyContact: string | null;
}

export function linkContext(pages: readonly HelpEntry[], privacyContact: string | null = null): LinkContext {
  const published = new Map<string, readonly string[]>();
  const pending = new Map<string, readonly string[]>();
  const planned = new Set<string>();
  for (const p of pages) {
    if (p.status === "published") published.set(p.slug, p.anchors ?? []);
    else if (p.status === "pending") pending.set(p.slug, p.anchors ?? []);
    else planned.add(p.slug);
  }
  return { published, pending, planned, privacyContact };
}

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const HELP_PAGE_RE = new RegExp(`^/help/(${SLUG})(?:#(${SLUG}))?$`);
const PLANNED_RE = new RegExp(`^/help/planned/(${SLUG})$`);
const FIXED_INTERNAL = new Set(["/help", "/help/planned", "/help/contact", "/launch", "/signin"]);

/**
 * `includePending` is for check:help's pass over pending pages only (a pending page may link
 * its sibling, which publishes with it). The renderer never sets it, so a published page that
 * links a pending slug fails H6 and a rendered link can never point at a 404.
 */
export function resolveLink(
  href: string,
  ctx: LinkContext,
  opts: { includePending?: boolean } = {},
): ResolvedLink | null {
  if (FIXED_INTERNAL.has(href)) return { kind: "internal", href };

  const planned = PLANNED_RE.exec(href);
  if (planned) return ctx.planned.has(planned[1]) ? { kind: "internal", href } : null;

  const page = HELP_PAGE_RE.exec(href);
  if (page && page[1] !== "planned") {
    const [, slug, anchor] = page;
    const anchors = ctx.published.get(slug) ?? (opts.includePending ? ctx.pending.get(slug) : undefined);
    if (anchors === undefined) return null;
    if (anchor !== undefined && !anchors.includes(anchor)) return null;
    return { kind: "internal", href };
  }

  // Exactly the configured address and nothing else, so a mailto: typed into a content file
  // (a stray real address) renders as plain text rather than as a link.
  if (ctx.privacyContact !== null && href === `mailto:${ctx.privacyContact}`) return { kind: "email", href };

  if (href.startsWith("https://")) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.username || url.password || url.search || url.hash) return null;
    const normalized = `${url.origin}${url.pathname}`.replace(/\/$/, "");
    return EXTERNAL_LINK_ALLOWLIST.includes(normalized) ? { kind: "external", href } : null;
  }

  return null;
}

/** Hosts of the external allowlist, for H9's off-allowlist host scan. */
export function allowedExternalHosts(): string[] {
  return EXTERNAL_LINK_ALLOWLIST.map((u) => new URL(u).host);
}
