import { platformOrigin } from "./host";
import { slugSitePath } from "@/lib/site-urls";

/**
 * The address a site keeps serving from while a custom domain is unconnected,
 * paused or lapsed, as a church reads it: `presbyportal.invalid/site/alder-creek`
 * (no scheme). PURE; the origin is the validated platform origin (T16), never a
 * request header. Falls back to the bare path when no safe origin is configured.
 */
export function platformSiteAddress(slug: string, env: Record<string, string | undefined> = process.env): string {
  const origin = platformOrigin(env);
  const path = slugSitePath(slug);
  return origin ? `${origin.replace(/^https?:\/\//, "")}${path}` : path;
}
