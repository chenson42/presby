import type { HelpEntry } from "./types";

/**
 * Every help page, in no particular order (select.ts orders them). Increment 1's pages
 * land in Batches 5a to 5c; the registry starts empty and every rule is vacuously true.
 *
 * Relative imports only (see types.ts); no fs, no `@/` runtime import. Page bodies are
 * src/content/help/<slug>.md, read at build by content.ts.
 */
export const HELP_PAGES = [
  // ---- Thinking about PresbyPortal -------------------------------------------------------
  {
    slug: "what-presbyportal-does",
    title: "What PresbyPortal does today",
    summary:
      "What a congregation can do with PresbyPortal now, and where the things it does not do are listed.",
    order: 10,
    status: "published",
    audience: "prospective",
    covers: [],
    labels: [],
    verifiedIn: "0.47.0",
  },
  {
    slug: "how-a-congregation-gets-started",
    title: "How a congregation gets started",
    summary:
      "There is no sign-up form. Here is how a congregation and its first administrator are set up.",
    order: 20,
    status: "published",
    audience: "prospective",
    covers: [],
    labels: ["You're invited", "This link isn't active"],
    verifiedIn: "0.47.0",
    limitationUntil: "signin-invites",
  },
  // ---- Everyone who signs in -------------------------------------------------------------
  {
    slug: "signing-in",
    title: "Signing in",
    summary:
      "Sign in with Google or with your email and password, and what to do when that does not work.",
    order: 10,
    status: "published",
    audience: "everyone",
    covers: ["route:/signin", "route:/forgot-password", "route:/reset-password"],
    labels: [
      "Sign in with Google",
      "Sign in with email",
      "Forgot password?",
      "Wrong email or password.",
      "Send reset link",
      "Check your email",
      "Set new password",
      "Password updated. Sign in with your new password.",
    ],
    verifiedIn: "0.47.0",
  },
  {
    slug: "using-your-code",
    title: "Using your code to sign in",
    summary:
      "Enter the code from your authenticator app, use a recovery code, and what to do if you lose your phone.",
    order: 20,
    status: "published",
    audience: "everyone",
    covers: ["route:/totp"],
    labels: [
      "Two-factor authentication",
      "Verify",
      "Recovery code",
      "Use a recovery code instead",
      "Use my authenticator app instead",
      "That code didn't match. Try again, or use a recovery code.",
    ],
    verifiedIn: "0.47.0",
  },
  {
    slug: "your-account",
    title: "Your account",
    summary: "Change your name, your email address or your password.",
    order: 30,
    status: "published",
    audience: "everyone",
    covers: ["route:/account"],
    labels: [
      "Account settings",
      "Profile",
      "Email address",
      "Password",
      "Two-factor authentication",
      "Display name",
      "Save name",
      "New email address",
      "Request email change",
      "Current password",
      "New password",
      "Confirm new password",
      "Change password",
    ],
    verifiedIn: "0.47.0",
  },
  {
    slug: "home-and-switching-congregations",
    title: "Your home page and switching congregations",
    summary: "Where you land after signing in, and how to move between congregations.",
    order: 40,
    status: "published",
    audience: "everyone",
    covers: ["route:/home", "route:/launch"],
    labels: [
      "Your organizations",
      "Still being set up",
      "Quick links",
      "What's new",
      "How are we doing?",
      "Switch organization",
      "Go to your home page",
      "Sign out",
    ],
    verifiedIn: "0.47.0",
  },
  {
    slug: "why-cant-i-see-this",
    title: "Why can't I see this?",
    summary:
      "Pages, buttons and congregations that are missing, and who can fix each one.",
    order: 50,
    status: "published",
    audience: "everyone",
    anchors: [
      "not-connected-to-a-congregation",
      "access-pending",
      "a-congregation-says-you-do-not-have-access",
    ],
    covers: ["route:/no-organization", "route:/access-pending"],
    labels: [
      "You're not connected to a congregation yet",
      "Your organization is being set up",
      "Your organizations are being set up",
      "Your congregation isn't on PresbyPortal yet",
      "Your access has ended",
      "Access pending",
      "Your account exists, but doesn't yet have permission for this area. Ask an administrator to grant you the right role.",
      "You don't have permission to",
      "You don't have access to",
      "Back to your organizations",
    ],
    verifiedIn: "0.47.0",
    limitationUntil: "signin-invites",
  },
  {
    slug: "using-the-directory",
    title: "Using the directory",
    summary: "Search the directory, read a household, and who to ask to change an entry.",
    order: 60,
    status: "published",
    audience: "everyone",
    covers: ["tile:directory"],
    labels: ["Directory", "Households", "Search the directory", "You don't have permission to view the directory."],
    verifiedIn: "0.47.0",
    limitationUntil: "person-photos",
  },
  {
    slug: "getting-help",
    title: "Getting help",
    summary: "How to ask a question, report a problem or send feedback.",
    order: 70,
    status: "published",
    audience: "everyone",
    covers: ["tile:tickets", "route:/o/{slug}/feedback"],
    labels: [
      "How are we doing?",
      "Share feedback",
      "Send feedback",
      "Give feedback",
      "Not today",
      "Stop asking",
      "Re-enable prompt",
      "Thanks — we read every one.",
      "A designated role-holder reviews everything shared here.",
      "Promote to ticket",
      "Dismiss",
      "File a ticket",
      "File ticket",
      "Ticket filed.",
      "Send reply",
      "Restricted",
    ],
    verifiedIn: "0.47.0",
  },
  // ---- Church administrators -------------------------------------------------------------
  {
    slug: "turning-features-on-and-off",
    title: "Turning features on and off",
    summary:
      "What the Features page does, which features start on, and which ones we turn on for you.",
    order: 20,
    status: "published",
    audience: "administrator",
    needs: {
      who: "A Founding Administrator, or anyone given a role that can turn features on and off.",
    },
    covers: ["tile:features"],
    overview: true,
    labels: [
      "Features",
      "Ministry areas",
      "Organization Administration",
      "Administration",
      "Community: add people and record roll actions",
      "Tiered sensitive information",
      "Member calendar",
      "Public events calendar",
      "Job openings",
      "Giving",
      "Parish management",
      "Website domain",
    ],
    verifiedIn: "0.47.0",
  },
] as const satisfies readonly HelpEntry[];

type Pages = (typeof HELP_PAGES)[number];

export type PublishedSlug = Extract<Pages, { status: "published" }>["slug"];
export type PlannedSlug = Extract<Pages, { status: "planned" }>["slug"];
/** The anchors a published slug declares; `never` when it declares none. */
export type AnchorOf<S extends PublishedSlug> =
  Extract<Pages, { slug: S }> extends { anchors: readonly (infer A)[] } ? A : never;
