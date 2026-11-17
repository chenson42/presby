import "server-only";

/**
 * The map's one configuration seam (DECISION-343): whether a tile key is set,
 * and the tile URL template the browser asks for. The ONLY file in `src/` that
 * names MAPTILER (a boundaries test pins it).
 *
 * PURE in the `help-contact/configured.ts` shape: a function of an environment
 * object, so a test passes any env and the page, which calls it on the server,
 * decides whether the map exists at all. The key is looked up through the
 * passed `env` (default `process.env`), never as a literal
 * `process.env.NEXT_PUBLIC_…` member, so it is read at request time on the
 * server and is never substituted into a client chunk. The client never reads
 * the environment: the key reaches the browser only inside `tileUrl`, and only
 * for a key holder whose presbytery has at least one pin.
 *
 * The key is PUBLIC and origin-restricted (the Turnstile site-key shape): it
 * authorizes nothing in presby, is never used in a server call, and is not a
 * credential in CLAUDE.md's sense. `NEXT_PUBLIC_` marks it as public.
 *
 * Tiles are MapTiler's 256-pixel raster PNGs for Leaflet (documented path
 * `/maps/<style>/256/{z}/{x}/{y}.png?key=`), so only CSP `img-src` changes and
 * `connect-src` stays `'self'`. `next.config.ts` cannot import a server-only
 * file, so it keeps the host as a literal and `map-config.test.ts` pins that
 * the two agree. The tile URL carries the key and nothing else: no slug, id or
 * name ever goes to the provider.
 */
export const MAP_TILE_ORIGIN = "https://api.maptiler.com";
export const MAP_STYLE_PATH = "/maps/streets-v4/256/{z}/{x}/{y}.png";

const KEY_SHAPE = /^[A-Za-z0-9_-]{8,128}$/;

export function mapTileConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { tileUrl: string } | null {
  const key = env.NEXT_PUBLIC_MAPTILER_KEY?.trim();
  if (!key || !KEY_SHAPE.test(key)) return null;
  return { tileUrl: `${MAP_TILE_ORIGIN}${MAP_STYLE_PATH}?key=${encodeURIComponent(key)}` };
}
