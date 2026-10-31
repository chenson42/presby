import type { HelpShot } from "./types";

/**
 * The screenshot manifest (P3-14): pure, hand-edited data. `screenshots.ts` binds each id to
 * its imported PNG; the capture spec (`npm run help:shots`) writes the PNGs and fails if any
 * `capturedIn` is not the current package.json version, so the stamp only moves by re-running
 * capture. check:help H7, H17 and H18 hold this, the files and the imports together.
 *
 * Every image is of the fixture congregation of scripts/seed-dev.sql (invented names), taken on a
 * from-scratch database behind the fail-closed guard (e2e/help-shots/guard.ts), light scheme,
 * device scale factor 2: `width` and `height` are the PNG's own pixels. `user` names who is signed in.
 */
export const HELP_SHOTS: readonly HelpShot[] = [
  {
    id: "signin-form",
    alt: "The sign-in page on a phone: the Google button, then the email and password form.",
    route: "/signin",
    user: "signed out",
    viewport: 360,
    width: 720,
    height: 1312,
    capturedIn: "0.47.0",
  },
  {
    id: "totp-boxes",
    alt: "The six boxes for the code from your authenticator app, with the Verify button and the recovery code link.",
    route: "/totp",
    user: "founding administrator (mfa-enrolled fixture), after the password step",
    viewport: 360,
    width: 624,
    height: 380,
    capturedIn: "0.47.0",
  },
  {
    id: "portal-tiles",
    alt: "The top of a congregation's page on a phone: tiles under Community, then Worship and Events.",
    route: "/o/alder-creek",
    user: "founding administrator",
    viewport: 360,
    width: 624,
    height: 2744,
    capturedIn: "0.47.0",
  },
  {
    id: "admin-hub",
    alt: "The Organization Administration page on a wide screen, with cards for each administration task.",
    route: "/o/alder-creek/admin",
    user: "founding administrator",
    viewport: 1280,
    width: 2208,
    height: 2652,
    capturedIn: "0.47.0",
  },
  {
    id: "features-list",
    alt: "The Features page on a phone: the ministry area switches, then a card with a switch for each feature.",
    route: "/o/alder-creek/admin/features",
    user: "founding administrator",
    viewport: 360,
    width: 624,
    height: 2320,
    capturedIn: "0.47.0",
  },
  {
    id: "community-list",
    alt: "The Community page on a phone: the view tabs, a search box, and a card for each person with an Edit button.",
    route: "/o/alder-creek/admin/community",
    user: "founding administrator",
    viewport: 360,
    width: 624,
    height: 1450,
    capturedIn: "0.47.0",
  },
  {
    id: "calendar-month",
    alt: "The Calendar page on a phone in list view: the month, then each day with its events.",
    route: "/o/alder-creek/calendar",
    user: "founding administrator",
    viewport: 360,
    width: 624,
    height: 2220,
    capturedIn: "0.47.0",
  },
];
