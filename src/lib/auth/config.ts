import NextAuth, { type NextAuthConfig } from "next-auth";
import { projectJWTOntoSession } from "./session-projection";

/**
 * Edge-safe NextAuth configuration.
 *
 * Critical: this module is imported by `src/proxy.ts`, which runs on the Edge
 * runtime. It MUST NOT import anything node-only (bcryptjs, the DrizzleAdapter,
 * the Neon client, etc.). The proxy only needs to decode the JWT cookie and
 * read claims (`roles`, `features`, `twoFactorVerified`) — no DB, no
 * provider-side cryptography.
 *
 * `src/auth.ts` extends this config with the real providers + adapter for the
 * Node-side request handlers and server actions. They share the same
 * `AUTH_SECRET`, so a JWT signed by the full config decodes cleanly here.
 */
export const authConfig: NextAuthConfig = {
  secret: process.env.AUTH_SECRET,
  // Trust the forwarded Host header so NextAuth builds OAuth callback URLs
  // using the public hostname rather than the internal one.
  //
  // NextAuth 5 beta auto-enables this on Vercel (VERCEL env) and Cloudflare
  // Pages (CF_PAGES env) but NOT on any other reverse proxy — nginx, Caddy,
  // Kinsta, Railway, Fly.io, and Cloudflare Tunnel in production all require
  // this explicit flag. Without it, OAuth callbacks use the internal hostname
  // and every sign-in fails with UntrustedHost.
  //
  // Security assumption: the terminating proxy sets the Host header from the
  // public hostname. Standard behaviour for any well-configured reverse proxy.
  // Deployers who prefer an env-scoped opt-in can remove this line and set
  // AUTH_TRUST_HOST=true (or AUTH_URL=https://myapp.com) in production — see
  // DECISION-016 in docs/decisions.md for the full rationale.
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [],
  pages: { signIn: "/signin" },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    // The session callback MUST live in the shared config (not only in
    // src/auth.ts) so the edge runtime sees `roles`, `features`,
    // `twoFactorRequired`, and `twoFactorVerified`. The actual projection is
    // in `session-projection.ts` so it can be unit tested without dragging
    // in the NextAuth runtime.
    async session({ session, token }) {
      return projectJWTOntoSession(session, token);
    },
  },
};

export const { auth: edgeAuth } = NextAuth(authConfig);
