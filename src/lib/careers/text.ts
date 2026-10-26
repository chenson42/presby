/**
 * Text hygiene for posting fields - pure, no `server-only`, no database, safe
 * for the client editor, the paste converter and the server alike
 * (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "Pure helpers").
 *
 * Posting text is staff-authored and PUBLIC, so what is stored is what is shown.
 * This module removes the characters that let a string lie about what it says:
 * control characters, the bidirectional overrides that reorder visible text
 * (a name written with U+202E reads backwards), and zero-width characters that
 * make two different strings look identical. It then puts the text in NFC so
 * the same word typed on two keyboards is one string.
 *
 * Lengths are counted in CODE POINTS (`charCount`), because Postgres'
 * `char_length` counts code points; counting UTF-16 units would refuse text the
 * database accepts (an emoji is two units, one character).
 */

/** C0 controls except tab (U+0009) and newline (U+000A), DEL, and the C1 block. */
const CONTROLS_KEEPING_TAB_AND_NEWLINE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
/** Every C0 control (tab and newline included), DEL, and the C1 block. */
const ALL_CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;
/** LRM/RLM, the embedding and override controls, and the isolates. */
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;
/** Zero-width space/non-joiner/joiner, word joiner, byte-order mark. */
const ZERO_WIDTH = /[​-‍⁠﻿]/g;

/** The number of characters (code points) in `value`: what Postgres' `char_length` counts. */
export function charCount(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

/**
 * Multi-line text: CRLF and lone CR become LF, then controls (except `\n` and
 * `\t`), bidi controls and zero-width characters are removed, then NFC.
 * Idempotent. Does not trim (the description keeps its own blank lines).
 */
export function normalizeMultiline(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(CONTROLS_KEEPING_TAB_AND_NEWLINE, "")
    .replace(BIDI_CONTROLS, "")
    .replace(ZERO_WIDTH, "")
    .normalize("NFC");
}

/**
 * Single-line text (title, summary, location, slug input): every control
 * character including tab and newline is removed, as are bidi and zero-width
 * characters, then NFC, then trimmed. A pasted line break inside a title
 * disappears rather than splitting the title.
 */
export function cleanText(raw: string): string {
  return raw
    .replace(ALL_CONTROLS, "")
    .replace(BIDI_CONTROLS, "")
    .replace(ZERO_WIDTH, "")
    .normalize("NFC")
    .trim();
}
