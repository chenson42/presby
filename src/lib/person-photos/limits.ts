/**
 * The person-photos cap. The image limits (upload ceiling, master and thumbnail
 * sizes, input caps) moved to `src/lib/storage/image/limits.ts` with the pipeline
 * they belong to (DECISION-346). No imports, so a client component can read it.
 */

/** The most photos a person can hold at one congregation (removed ones do not count). */
export const PHOTO_CAP_PER_PERSON = 10;
