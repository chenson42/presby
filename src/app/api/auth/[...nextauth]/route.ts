import { handlers } from "@/auth";

export const { GET } = handlers;

/**
 * The browser-facing session endpoint is read-only. Nothing in the app updates
 * a session from the client (server actions call `unstable_update()`, which
 * runs Auth.js in-process and never comes through this route), so a POST to
 * `/api/auth/session` is refused outright: no body, no cookie. Every other
 * POST (credentials callback, provider sign-in, sign-out) goes to NextAuth.
 * This is defence in depth; the jwt callback does not depend on it
 * (DECISION-230).
 */
export const POST: typeof handlers.POST = async (req) => {
  if (new URL(req.url).pathname === "/api/auth/session") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  return handlers.POST(req);
};
