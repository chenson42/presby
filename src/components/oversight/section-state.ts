/** What a section of the record page was given: its rows, a Locked card, or a load error (its reader threw). */
export type SectionState<T> = { kind: "ok"; data: T } | { kind: "locked" } | { kind: "error" };
