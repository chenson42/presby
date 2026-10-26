/**
 * Pure limits shared by the server pipeline (`image.ts`, `store.ts`) and the
 * client island that downscales before upload (docs/work-log/
 * 2026-10-26-person-photos-inc1.md, Phase 3 "Library"). No imports, so a
 * client component can read it.
 *
 * The server's own ceiling (`UPLOAD_MAX_BYTES`) sits under the framework's 1 MiB
 * Server Action body limit (F330), which is why the client aims lower
 * (`CLIENT_TARGET_BYTES`): the server is the authority, the client is only
 * courtesy.
 */

/** The most photos a person can hold at one congregation (removed ones do not count). */
export const PHOTO_CAP_PER_PERSON = 10;

/** Server refusal threshold for an uploaded file, under the framework's 1 MiB body limit. */
export const UPLOAD_MAX_BYTES = 1_000_000;
/** What the client downscale aims for, with headroom under `UPLOAD_MAX_BYTES`. */
export const CLIENT_TARGET_BYTES = 900_000;
/** The client's first downscale target (long edge, px). */
export const CLIENT_MAX_EDGE = 1600;

/** The stored master's longest edge (px). Never enlarged; no forced crop. */
export const MASTER_MAX_EDGE = 1200;
/** The stored master's byte ceiling; quality then size step down until it fits. */
export const MASTER_MAX_BYTES = 400_000;
/** The thumbnail is THUMB_EDGE x THUMB_EDGE, a top-biased crop, WebP. */
export const THUMB_EDGE = 160;

/** Refused from the image header, before any pixel is decoded. */
export const MAX_INPUT_PIXELS = 16_000_000;
/** Refused from the image header: no side may exceed this (px). */
export const MAX_INPUT_EDGE = 6000;
