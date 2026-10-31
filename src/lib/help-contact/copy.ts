/**
 * Every string the contact feature adds that is not in a help page (Phase 3
 * "Copy"; the group letters A to L match that section). PURE: no imports, so the
 * client island may walk it (H19, DECISION-304).
 *
 * Sections are added by the batch that renders them: A to C (the form) and E
 * (the notification email) are here; D (the inbox) arrives with the inbox.
 *
 * Not here on purpose: the numbers the strings quote. The limits come from
 * `HELP_CONTACT_LIMITS` in contract.ts and the notification window is the
 * definer's constant (docs/work-log/2026-10-31-help-contact.md, Copy B and E,
 * "Source of truth").
 */

/** Thousands separators without `toLocaleString` (the repo bans it in components, and the output must not vary by locale). */
export function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The limits the strings quote. Repeats contract.ts's HELP_CONTACT_LIMITS on purpose: copy.ts imports nothing; a test pins they are equal. */
const MESSAGE_MAX = 2000;
const NAME_MAX = 100;
const CONGREGATION_MAX = 150;
const EMAIL_MAX = 254;
const MESSAGE_MIN = 10;

/**
 * A. The form page (`/help/contact`). Strings the labels list of a help page quotes
 * (getting-help, how-a-congregation-gets-started, using-your-code, setting-up-two-factor)
 * are exactly the ones in this table: H10 checks each is in a source file.
 */
export const HELP_CONTACT_FORM_COPY = {
  title: "Contact the PresbyPortal team",
  intro1: "Write to the PresbyPortal team. You do not need an account. A person reads every message.",
  intro2:
    "We do not send an automatic reply, and we cannot promise a reply or a time. If we reply, it comes by email from a person.",
  topicLabel: "What is this about?",
  topicPlaceholder: "Choose a topic",
  topics: {
    starting_a_congregation: "Starting a congregation",
    signing_in: "I can't sign in or I lost my codes",
    help_page_wrong: "A help page is wrong",
    something_else: "Something else",
  },
  nameLabel: "Your name (optional)",
  emailLabel: "Your email address",
  emailHelper: "So we can reply. We do not send anything to this address automatically.",
  congregationLabel: "Your congregation (optional)",
  messageLabel: "Your message",
  messageHelper: `At least ${MESSAGE_MIN} characters. Please do not include passwords or recovery codes.`,
  counter: (n: number) => `${withCommas(n)} of ${withCommas(MESSAGE_MAX)} characters`,
  counterUsed: (n: number) => `${withCommas(n)} of ${withCommas(MESSAGE_MAX)} characters used.`,
  counterLimit: `You have reached the ${withCommas(MESSAGE_MAX)} character limit.`,
  honeypotLabel: "Leave this field blank",
  /** The notice is split around the privacy-policy link: lead + link text + tail. */
  noticeLead:
    "The team reads your message. We keep your name if you give it, your email address, your congregation if you give it, the topic, your message and the time you sent it. We do not store your IP address or browser details with the message. To slow down abuse we count messages by IP address for a short time, and Cloudflare Turnstile checks that you are a person. Do not include passwords, recovery codes, or private details about other people. See the ",
  noticeLinkText: "privacy policy",
  noticeTail: ".",
  button: "Send message",
  buttonPending: "Sending\u2026",
  waiting: "Waiting for the check to finish\u2026",
  errorSummary: "Your message was not sent. Fix these first:",
} as const;

/** The character counts at which the visually hidden live region speaks (never per keystroke). */
export const HELP_CONTACT_ANNOUNCE_AT = 1800;
export const HELP_CONTACT_LIMIT_CHARS = MESSAGE_MAX;

/** B. Outcomes and field errors. */
export const HELP_CONTACT_OUTCOME_COPY = {
  sentHeading: "Your message was sent.",
  sentBody:
    "The PresbyPortal team has it, and a person reads each message. We do not send an automatic reply, so you will not get a confirmation email. We cannot promise a reply or a time. If we reply, it comes by email from a person.",
  sentSigningIn:
    "A message cannot reset anything by itself. If your message is about an account, we reply to the email address on that account, which may not be the one you typed here.",
  checkFailed: "We could not confirm that you are a person. Please try again.",
  busy: "We can't take messages right now. Please try again later.",
  notSent: "We couldn't send your message. Your text is still here, so you can try again in a few minutes.",
  topic: "Choose what this is about.",
  emailRequired: "Enter your email address so we can reply.",
  emailBadFormat: "That does not look like an email address. Check for a missing @ or a typing mistake.",
  emailTooLong: `That email address is too long. The limit is ${EMAIL_MAX} characters.`,
  messageShort: `Write a message of at least ${MESSAGE_MIN} characters.`,
  messageTooLong: (n: number) =>
    `Your message is ${withCommas(n)} characters. The limit is ${withCommas(MESSAGE_MAX)}. Shorten it and send it again.`,
  nameTooLong: `Your name is too long. The limit is ${NAME_MAX} characters.`,
  congregationTooLong: `The congregation name is too long. The limit is ${CONGREGATION_MAX} characters.`,
} as const;

/** C. Unavailable, "check didn't load", no JavaScript, and the shared exit block. */
export const HELP_CONTACT_EXIT_COPY = {
  unavailableHeading: "The contact form isn't available right now",
  unavailableBody: "You can still reach us another way.",
  line1: "If someone invited you, ask the person who invited you.",
  /** Line 2 is split around the repository link: lead + link text + tail. */
  line2Lead: "Or open an issue on the ",
  line2LinkText: "PresbyPortal repository",
  line2Tail:
    ". Issues there are public, so leave out personal details, passwords and recovery codes. You need a GitHub account.",
  checkDidNotLoad:
    "The check that confirms you are a person did not load. Turn off any content blocker for this page, or try another browser.",
  noScript: "This form needs JavaScript to run its check. Turn JavaScript on, or reach us another way.",
} as const;

/**
 * E. The notification email (`help_contact_notification`). CONSTANT and
 * content-free: the typed name, address, congregation and message are not
 * parameters of anything that builds it (C5, C9), so there is no path by which
 * a stranger's text reaches an operator's mail.
 */
export const HELP_CONTACT_EMAIL_COPY = {
  subject: "New message on the PresbyPortal contact form",
  preheader: "Open the inbox to read it.",
  heading: "A new contact message",
  paragraph1:
    "Someone sent a message to the PresbyPortal team through the contact form. The message is not in this email.",
  paragraph2:
    "You get this email at most once an hour, however many messages arrive. Open the inbox to read them.",
  button: "Open contact messages",
  footnote: "You are receiving this because your account can work tickets and contact messages.",
} as const;

/** The in-app path the email button opens; the origin is added by `platformOrigin()`. */
export const HELP_CONTACT_INBOX_PATH = "/admin/messages";
