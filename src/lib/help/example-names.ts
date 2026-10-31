/**
 * Fictional organisation names content may use (H9's named-congregation heuristic), and generic
 * phrases that look like a name but are not. These are the invented fixtures of
 * scripts/seed-dev.sql and e2e/support/seed-orgs.ts; no real congregation belongs here.
 */
export const EXAMPLE_NAMES: readonly string[] = [
  "Alder Creek Presbyterian Church",
  "Bramblewood Presbyterian Church",
  "Quillhaven Presbyterian Church",
  "Fernwood Presbyterian Church",
  "Marrowbone Presbyterian Church",
  "Wrenfield Presbyterian Church",
  "Thistledown Presbyterian Church",
  "Halloway Presbyterian Church",
];

/** Capitalised phrases ending in Church, Presbytery or Synod that name no one. */
export const GENERIC_PHRASES: readonly string[] = ["Presbyterian Church"];

/** Sentence-leading words dropped before a phrase is read as a name ("The Church"). */
export const LEAD_WORDS: readonly string[] = [
  "The", "A", "An", "Your", "Our", "Their", "Its", "This", "That", "These", "Those",
  "Each", "Every", "Any", "Some", "Local", "Home", "Another", "Which", "Whose", "Ask", "Tell",
  "If", "When", "Where", "Whether", "And", "Or", "But", "For", "In", "On", "At", "To", "Of", "By", "With",
];
