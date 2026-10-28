import { HELP_SHOTS } from "./screenshots-data";
import signinForm from "@/content/help/images/signin-form.png";
import totpBoxes from "@/content/help/images/totp-boxes.png";
import portalTiles from "@/content/help/images/portal-tiles.png";
import adminHub from "@/content/help/images/admin-hub.png";
import featuresList from "@/content/help/images/features-list.png";
import communityList from "@/content/help/images/community-list.png";
import calendarMonth from "@/content/help/images/calendar-month.png";

/**
 * Binds each manifest id (screenshots-data.ts) to its imported PNG (P3-14). The images are
 * STATIC IMPORTS from src/content/help/images/, never files in public/ (public/ would answer
 * /help/<file>.png on every host, including a church's own domain). check:help H18 requires
 * exactly one `import <name> from "@/content/help/images/<id>.png"` per manifest entry and
 * none without one. Written by hand: the capture (`npm run help:shots`) writes the PNGs, never this file.
 */
type ImportedImage = { src: string };

const IMAGES: Readonly<Record<string, ImportedImage>> = {
  "signin-form": signinForm,
  "totp-boxes": totpBoxes,
  "portal-tiles": portalTiles,
  "admin-hub": adminHub,
  "features-list": featuresList,
  "community-list": communityList,
  "calendar-month": calendarMonth,
};

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
