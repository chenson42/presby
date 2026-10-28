import type { HelpShot } from "./types";

/**
 * The screenshot manifest (P3-14): pure, hand-edited data. `screenshots.ts` binds each id to
 * its imported PNG; the capture spec (`npm run help:shots`) writes the PNGs and fails if any
 * `capturedIn` is not the current package.json version, so the stamp only moves by re-running
 * capture. check:help H7, H17 and H18 hold this, the files and the imports together.
 */
export const HELP_SHOTS: readonly HelpShot[] = [];
