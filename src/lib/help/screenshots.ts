import { HELP_SHOTS } from "./screenshots-data";

/**
 * Binds each manifest id (screenshots-data.ts) to its imported PNG (P3-14). The images are
 * STATIC IMPORTS from src/content/help/images/, never files in public/ (public/ would answer
 * /help/<file>.png on every host, including a church's own domain). check:help H18 requires
 * exactly one `import <name> from "@/content/help/images/<id>.png"` per manifest entry and
 * none without one; there are no images yet (Batch 4 adds the first seven).
 */
type ImportedImage = { src: string };

const IMAGES: Readonly<Record<string, ImportedImage>> = {};

const SHOT_SCHEME = "shot:";

/** The renderer's `resolveImage`: only `shot:<id>` with an id in both the manifest and the imports. */
export function resolveShot(
  source: string,
  images: Readonly<Record<string, ImportedImage>> = IMAGES,
  shots: readonly { id: string; width: number; height: number }[] = HELP_SHOTS,
): { src: string; width: number; height: number } | null {
  if (!source.startsWith(SHOT_SCHEME)) return null;
  const id = source.slice(SHOT_SCHEME.length);
  const shot = shots.find((s) => s.id === id);
  const image = Object.hasOwn(images, id) ? images[id] : undefined;
  if (!shot || !image) return null;
  return { src: image.src, width: shot.width, height: shot.height };
}
