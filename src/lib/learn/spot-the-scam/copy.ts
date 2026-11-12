/**
 * Every user-facing string the Spot the scam surfaces add, in ONE reviewed place
 * (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 Copy G3 to G8). PURE: no imports,
 * so the client island, the server frame, the route, the (org) page and the tests all
 * read the same text. `content.ts` holds the scenarios; this holds everything around
 * them, so the scenario set can be reviewed and versioned alone and the help labels
 * (`npm run check:help`, H10) match one place.
 *
 * The scoped promise is "answers are never sent or saved". Nothing here says the page
 * "makes no requests" or that "nothing you tap can hurt you": the site's own chrome may
 * make requests, and a live slot cannot turn off an iOS data detector (F439).
 *
 * Strings use straight apostrophes, never an HTML entity: React escapes text.
 */

export const NAME = "Spot the scam";

export const FRAME = {
  /** The page heading (route and (org) page; a slot's host page owns its own). */
  heading: NAME,
  lede:
    "Seven made-up messages follow: emails, a text and a voicemail, like the ones reaching churches and homes right now. Some are genuine. Some are scams that AI has made far more convincing than they used to be. For each one, decide: does it look genuine, or is something off? You'll see what gave it away either way.",
  madeUpChurch:
    "The messages are about a made-up church, Thistledown Presbyterian Church. Its real email addresses end in thistledownpres.invalid. The people, companies and web addresses in them are all made up, and none of these messages was ever sent.",
  privacy: "It takes about ten minutes. Your answers stay on this page. They are never sent or saved.",
  leaderNote: "Leading a group? Put this on a screen, vote out loud, and talk about what gave each message away.",
  practiceHeading: "Practice",
  noscript:
    "This practice needs JavaScript, and it looks like JavaScript is turned off in your browser. The six rules below still apply.",
  rulesHeading: "The six rules to keep",
  backTo: (organizationName: string) => `Back to ${organizationName}`,
  title: (organizationName: string) => `${NAME} | ${organizationName}`,
} as const;

/** The one notice the slot shows for `unavailable` and `failed` alike, and the route shows for `failed` (DECISION-154). */
export const NOTICE = {
  unavailable: "Our scam-spotting practice isn't available right now. Please check back soon.",
} as const;

export const TRAINER = {
  progress: (n: number, total: number) => `Message ${n} of ${total}`,
  correctSoFar: (k: number) => `${k} correct so far`,
  from: "From:",
  subject: "Subject:",
  voicemailCaption: "A written copy of the voicemail. There is no recording.",
  prompt: "What do you think?",
  looksGenuine: "Looks genuine",
  somethingsOff: "Something's off",
  right: "Right.",
  notQuite: "Not quite.",
  whatToNotice: "What to notice",
  next: "Next message",
  seeResult: "See your result",
  resultEyebrow: "Your result",
  resultHeading: (score: number, total: number) => `${score} of ${total} correct`,
  perfect:
    "A sharp eye. Now share what you know: tell someone you know who gets a lot of email and could use a hand with it.",
  notPerfect:
    "Every one you missed here is one you'll catch in real life. That is the whole point of practicing somewhere safe.",
  printNote:
    "The six rules are just below. Your browser's Print command will print them without the practice.",
  restart: "Practice again",
} as const;

/** The (org) page (Copy G8). */
export const ORG_PAGE = {
  heading: NAME,
  off: (name: string) => `Spot the scam isn't turned on for ${name} yet.`,
  offLink: "Turn it on under Features",
  offAsk: (name: string) => `Ask someone who manages ${name}'s features to turn it on.`,
  loadError: "We couldn't load Spot the scam right now. Try again in a moment.",
  tryAgain: "Try again",
} as const;

export const LEADER = {
  heading: "Using this outside the portal",
  live: (address: string) => `Anyone can use this on your public website, with no sign-in: ${address}`,
  openLink: "Open the public page",
  notLive:
    "Your public website isn't showing right now, so there is no public address to share yet. People who sign in to the portal can still use this page.",
  unknown: "We couldn't check your public address just now. Try again later.",
  maintainer: "Whoever maintains your website can also place this on a page.",
  lastReviewed: (date: string) => `The practice messages were last reviewed on ${date}.`,
  helpLink: "About Spot the scam",
} as const;
