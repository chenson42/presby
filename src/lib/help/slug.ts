/**
 * Heading slugs. Hand-written (no new dependency) and shared by the renderer's heading
 * ids and extractHeadings, so the two cannot disagree (Phase 3 renderer contract).
 */
export function headingSlug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A per-document slugger: repeats become `-2`, `-3`, never colliding with a natural slug. */
export function createSlugger(): (text: string) => string {
  const used = new Set<string>();
  return (text) => {
    const base = headingSlug(text) || "section";
    let candidate = base;
    for (let n = 2; used.has(candidate); n++) candidate = `${base}-${n}`;
    used.add(candidate);
    return candidate;
  };
}
