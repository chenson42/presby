/**
 * The help site's chrome strings (Phase 3 Copy C1). Pure: no imports. Page prose is not here
 * (it lives in src/content/help/); the planned-placeholder wording is also here so the one
 * component that may use future-tense-looking wording has its strings in one reviewed place.
 */
import type { HelpNeeds } from "./types";

export const HELP_COPY = {
  skipLink: "Skip to main content",
  wordmarkLabel: "PresbyPortal",
  headerHelp: "Help",
  headerSignIn: "Sign in",
  headerOpen: "Open PresbyPortal",
  headerNavLabel: "Help site",

  indexTitle: "Help",
  indexIntro: "Plain-language guides for the people who use PresbyPortal. They are written for congregations.",
  indexNote: "If a screen looks different from what you read here, tell the person who invited you.",
  plannedLinkTitle: "Planned and not available yet",
  plannedLinkLine: "Things PresbyPortal does not do yet.",

  breadcrumbLabel: "Breadcrumb",
  breadcrumbHelp: "Help",
  onThisPage: "On this page",
  lastChecked: (version: string) => `Last checked against release ${version}.`,
  previous: (title: string) => `Previous: ${title}`,
  next: (title: string) => `Next: ${title}`,
  backToIndex: "Back to the help index",
  pageNavLabel: "More help pages",

  tableLabel: "Table. Scroll sideways to see all of it.",
  externalCue: " (opens in a new tab)",

  footerContactLead: "Can't find what you need?",
  footerContactLink: "Write to the PresbyPortal team",

  notFoundTitle: "We couldn't find that page",
  notFoundBody: "The link may be old or mistyped.",
  notFoundLink: "Go to the help index",

  plannedTitle: "Planned and not available yet",
  plannedIntro: "These are things PresbyPortal does not do yet. Being listed here is not a promise and has no date.",
  plannedLabel: "Planned. Not available yet. There is no date.",
  plannedWho: (forWhom: string) => `Who it is for: ${forWhom}`,
  plannedToday: (today: string) => `Today: ${today}`,
  plannedTabTitle: (name: string) => `${name} (planned, not available yet)`,
  plannedAllLink: "All planned items",
  plannedEmpty: "Nothing is listed here right now.",

  needsHeading: "What you need",
  needsWho: "Who",
  needsTurnOn: "Turn on",
  needsAppliesTo: "Applies to",
  needsSwitchedOn: "Switched on for you",
} as const;

const APPLIES_TO: Record<NonNullable<HelpNeeds["appliesTo"]>, string> = {
  all: "Any organization on PresbyPortal.",
  congregations: "Congregations.",
  "congregations-and-nwcs": "Congregations and new worshiping communities.",
  presbyteries: "Presbyteries.",
};

export function appliesToText(appliesTo: NonNullable<HelpNeeds["appliesTo"]>): string {
  return APPLIES_TO[appliesTo];
}

export function turnOnText(name: string, defaultOn: boolean): string {
  return `In Features, turn on "${name}". ${defaultOn ? "It is on by default." : "It is off by default."}`;
}

/**
 * Plain text, not markdown: the Needs block renders it in a <dd>, where a link would show raw
 * brackets. Names the ticket route (the reader is an administrator) and the inviter.
 */
export function switchedOnText(name: string): string {
  return `The PresbyPortal team turns on "${name}" for you. To ask for it, file a ticket (Administration, then Tickets) or ask the person who invited you.`;
}
