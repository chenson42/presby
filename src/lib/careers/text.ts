/**
 * Re-export of the pure text-hygiene helpers, which moved to
 * src/lib/text-hygiene.ts when /help/contact became their second consumer
 * (docs/work-log/2026-10-31-help-contact.md, Phase 2 CA12). Careers importers
 * keep this path; new code imports `@/lib/text-hygiene` directly.
 */
export * from "@/lib/text-hygiene";
