/**
 * The Spot the scam practice messages: PURE DATA, no imports, so it can be read
 * by the client island, the server frame and the tests alike
 * (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 Copy G6 and G7; DECISION-333, DECISION-335).
 *
 * ONE FICTIONAL WORLD. Every message is about a made-up church, Thistledown
 * Presbyterian Church, whose real addresses end in `thistledownpres.invalid`. Every
 * scam sender's look-alike is a hyphen swap of a real domain. No council, synod or
 * presbytery is named; no real company, place or person; no phone number or
 * phone-shaped digits; the routing and account numbers are invented, grouped and
 * invalid by construction. No scenario carries a link, `tel:`, `mailto:`, markup, a
 * date or a time (an iOS data detector would offer to act on it). `content.test.ts`
 * pins all of that, and pins the operator-approved voicemail (scenario 7) and the
 * sixth rule byte for byte.
 *
 * The messages are PLATFORM-OWNED and ship to every organization at once. Review
 * them every six months against current scam patterns (docs/TODO.md owns the
 * cadence): re-read this file, bump `VERSION` and `LAST_REVIEWED`, ship as an
 * ordinary fix; the operator reviews the text. `LAST_REVIEWED` is shown to a leader
 * on the (org) page only.
 *
 * Strings use straight apostrophes (`can't`), never an HTML entity: React renders
 * text and escapes it. The double quotes inside a few tells are typographic, as the
 * operator-approved text has them.
 */

/** Bumped when any scenario or rule changes. */
export const VERSION = 1;

/** The day the messages were last read against current scam patterns (ISO date). */
export const LAST_REVIEWED = "2026-11-11";

/** The made-up church every message is about. */
export const CHURCH = {
  name: "Thistledown Presbyterian Church",
  domain: "thistledownpres.invalid",
} as const;

export type Channel = "email" | "text" | "voicemail";

export interface Scenario {
  channel: Channel;
  /** The sender's display name (email), the number description (text), or "Unknown caller" (voicemail). */
  from: string;
  /** An email's sending address. A text or a voicemail has none. */
  fromAddress?: string;
  /** An email's subject line. */
  subject?: string;
  /** The header line of a text ("Text message · ...") or a voicemail ("Voicemail · 0:41"). */
  meta?: string;
  /** A voicemail's italic stage direction, shown above the transcript. */
  direction?: string;
  /** Plain paragraphs, rendered as text. */
  body: readonly string[];
  isScam: boolean;
  verdictTitle: string;
  tells: readonly string[];
  lesson: string;
}

export const SCENARIOS: readonly Scenario[] = [
  // 1. Email, scam: the pastor gift-card scam.
  {
    channel: "email",
    from: "Pastor Ellis Hartwell",
    fromAddress: "ellis.hartwell@thistledown-pres.invalid",
    subject: "Quiet favor — please keep between us",
    body: [
      "Hi, are you available? I need a discreet favor.",
      "A family at church is in crisis and I want to get them help today without embarrassing them. Could you buy four $100 gift cards at the grocery store and send me photos of the codes on the back? I will pay you back on Sunday.",
      "I'm heading into a hospital visit and can't take calls. Please do this quickly and keep it between us.",
      "Blessings, Pastor Ellis",
    ],
    isScam: true,
    verdictTitle: "This is the classic pastor gift-card scam.",
    tells: [
      "The address is a look-alike. Thistledown's real addresses end in thistledownpres.invalid. This one is thistledown-pres.invalid, with a hyphen added.",
      "Gift cards as payment. No pastor will ever ask you to send gift-card codes. Ever.",
      "Urgency plus secrecy: “today,” “can't take calls,” “keep it between us.” It is built so you won't check.",
      "A reason you can't call to check is built right into the message.",
    ],
    lesson:
      "Check through a second channel you already trust: call the pastor's real number or walk to the office. Never reply, and never buy the cards. AI now writes these fluently, so bad grammar is no longer a reliable tell.",
  },
  // 2. Email, genuine: the church office newsletter.
  {
    channel: "email",
    from: "Thistledown Church Office",
    fromAddress: "office@thistledownpres.invalid",
    subject: "This week: potluck sign-up and session packet",
    body: [
      "Friends,",
      "Two reminders for the week. The all-church potluck is Sunday after worship. The sign-up sheet is in the narthex, or reply to this email and Joan will add you.",
      "Elders: the session packet for Tuesday's meeting is attached, same as every month.",
      "See you Sunday!",
    ],
    isScam: false,
    verdictTitle: "This one is genuine.",
    tells: [
      "It comes from the church's real address, the one every other newsletter comes from.",
      "It asks for nothing sensitive: no money, no codes, no passwords, no links to “verify” anything.",
      "No urgency, no secrecy. It invites you to reply to a person you know.",
      "It matches an expected rhythm: the monthly packet, the usual potluck.",
    ],
    lesson:
      "Genuine church email is boring in the best way: an expected sender, an expected rhythm, nothing demanded. Caution is good, but the goal is confidence, not fear of every message.",
  },
  // 3. Text, scam: the impersonation text, the opening move.
  {
    channel: "text",
    from: "A number you don't have saved",
    meta: "Text message · A number you don't have saved",
    body: [
      "Hello, this is Pastor Ellis. I'm in a meeting and can't talk. Are you free? I need you to handle something for me right away. God bless.",
    ],
    isScam: true,
    verdictTitle: "This is an impersonation text, the opening move.",
    tells: [
      "A number you don't have saved, claiming to be your pastor. Scammers copy names from church websites.",
      "“Can't talk right now”: the excuse not to check is built in before you can ask.",
      "A vague, urgent favor. The real ask (usually gift cards or a wire) comes after you reply.",
      "A slightly off tone. AI lets scammers copy a pastor's style convincingly, but the situation itself is the tell.",
    ],
    lesson:
      "Don't reply, even to say no. A reply tells them your number works. Text or call the pastor at the number you already have. Then warn the people around you at church or work; these arrive in waves.",
  },
  // 4. Email, scam: business email compromise aimed at the treasurer.
  {
    channel: "email",
    from: "Brightwater Supply Billing",
    fromAddress: "billing@brightwater-supply.invalid",
    subject: "URGENT: updated banking details for your invoice",
    body: [
      "Dear Treasurer,",
      "Our payment account has changed as part of a banking transition. Effective immediately, please send this month's invoice payment to the new account below.",
      "Routing: 9900 00001 · Account: 0000 1234 5678",
      "This must be completed before Friday to avoid a late fee and a hold on your church's account. Do not reply to this email; it is monitored by our audit partner.",
    ],
    isScam: true,
    verdictTitle: "This is business email compromise, aimed at your treasurer.",
    tells: [
      "“Updated banking details” is the single most expensive scam a church treasurer will face.",
      "The address is a look-alike. Brightwater's earlier invoices came from brightwatersupply.invalid; this one is brightwater-supply.invalid. You would only catch it by comparing with an invoice you already have.",
      "A deadline plus a threat (a late fee and a hold) to rush you past checking.",
      "“Do not reply” closes off the easy way to check.",
    ],
    lesson:
      "Any change to where money goes gets checked by phone, using a number you already have on file, never one from the email. A real vendor will happily wait a day while you check.",
  },
  // 5. Email, scam: credential phishing.
  {
    channel: "email",
    from: "Church Email System",
    fromAddress: "no-reply@mailbox-quota-alerts.invalid",
    subject: "Action required: your mailbox will be deactivated in 24 hours",
    body: [
      "Your mailbox storage is 99% full. Incoming messages will be rejected within 24 hours.",
      "To keep your account active, verify your mailbox now:",
      "[A large button reads: KEEP MY ACCOUNT ACTIVE]",
      "This is an automated message from your email provider.",
    ],
    isScam: true,
    verdictTitle: "This is credential phishing: it is after your password.",
    tells: [
      "A countdown and a threat: lose your email unless you act now.",
      "The sender is a generic, alarm-sounding address, not your actual email provider.",
      "One big button whose whole job is to take you to a fake sign-in page.",
      "It's addressed to no one. Real providers usually name you and your account.",
    ],
    lesson:
      "Never sign in through a link in an alarming email. Go to your email provider directly, the way you always do. If your account were really full, you would see it there. This is how church accounts get taken over, then used to scam everyone who trusts the sender.",
  },
  // 6. Email, genuine: the supper series invitation.
  {
    channel: "email",
    from: "Thistledown Supper Series",
    fromAddress: "suppers@thistledownpres.invalid",
    subject: "Registration open: fall supper series (free)",
    body: [
      "Friends,",
      "Registration is open for our free fall supper series, “Stories from the Mission Field,” on Wednesday evenings this fall. Sign up on our website under Events, or reply and we'll add you.",
      "Each evening's slides will be posted afterward, as always, on the church website.",
      "Grace and peace,",
    ],
    isScam: false,
    verdictTitle: "This one is genuine.",
    tells: [
      "The sender matches the church's real address and its normal voice.",
      "Nothing is demanded: no deadline pressure, no payment, no sign-in link.",
      "It points you to the website you already know, not to a special button.",
      "“As always” fits an established pattern you can check for yourself.",
    ],
    lesson:
      "When in doubt, go there yourself: type the address or use your bookmark instead of tapping anything. A genuine invitation survives that detour. A scam depends on you not taking it.",
  },
  // 7. Voicemail, scam: the "grandchild in trouble" scam with a cloned voice.
  // OPERATOR-APPROVED TEXT (2026-11-11), verbatim, last. Do not edit without the operator.
  {
    channel: "voicemail",
    from: "Unknown caller",
    meta: "Voicemail · 0:41",
    direction: "(crying, out of breath)",
    body: [
      "\"Grandma? Grandma, it's me. Please don't be mad. I was in a car accident and they're saying it was my fault, and I'm at the police station. My nose is broken, so I sound weird. Please don't call Mom and Dad, they'll kill me. There's a lawyer here, Mr. Grant. He's going to call you back in a few minutes and tell you what to do. Please, Grandma, I'm so scared. I love you.\"",
    ],
    isScam: true,
    verdictTitle: "This is the \"grandchild in trouble\" scam, now with a cloned voice.",
    tells: [
      "The voice can sound exactly right. A few seconds of someone's voice from a video online is enough for AI to copy it. A voice that sounds like your grandchild no longer proves it's your grandchild.",
      "It explains away anything that sounds off. \"My nose is broken, so I sound weird\" is there so you won't trust your doubts.",
      "It asks you to keep it secret. \"Don't call Mom and Dad\" stops you from checking with the one person who could clear it up in a minute.",
      "It's a crisis that only money fixes. A \"lawyer\" will call next asking for bail, often cash handed to a courier who comes to your door, or gift cards.",
      "It's built to rush you. Fear and love are used so you act before you think.",
    ],
    lesson:
      "Hang up and call your grandchild yourself, on the number you already have. If they don't answer, call their parents, even though the message told you not to. Then agree on a family code word that only your family knows, and ask for it whenever a call like this comes in. Police and courts never take bail in cash at your door or in gift cards.",
  },
];

/** The rules card: six rules, the sixth operator-approved (2026-11-11). */
export const RULES: readonly string[] = [
  "Verify through a second channel you already trust — call the number you have, not the one in the message.",
  "No pastor, treasurer, or church body will ever ask for gift-card codes. That request alone settles it.",
  "Urgency + secrecy = stop. Real ministry survives a one-day pause to check.",
  "Look at the actual sending address or number, not the display name.",
  "Never sign in through an emailed link — go to the site the way you always do.",
  "A familiar voice is not proof. Hang up and call back on a number you already have — and agree on a family code word.",
];
