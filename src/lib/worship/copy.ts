import { REASON_LABELS, type Reason } from "./vocab";

/**
 * Every user-facing string worship Increment 1 adds, in ONE module -
 * docs/work-log/2026-11-04-worship-inc1.md, Phase 3 "Copy" (G1 to G8). Pages,
 * actions, emails and tests import from here; none writes a sentence of its
 * own. PURE: no `server-only`, no database.
 *
 * `copy.test.ts` pins the load-bearing strings byte for byte and fails on the
 * word "session" anywhere in this file (G3: a "session" is the church court,
 * not a rehearsal). A string a page needs that is not here is a missing ruling:
 * stop and ask, do not write one in the component.
 *
 * Dates in running text are rendered by `<FormattedDate>` on a page; the email
 * builders format their own through `messages.ts` ("Sunday, November 16 at
 * 9:00 AM").
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// ---------------------------------------------------------------------------
// G1 - tile, catalog, permissions, template
// ---------------------------------------------------------------------------

export const TILE_COPY = {
  member: {
    label: "Worship",
    description: "See when you're asked to serve, answer requests, and set dates you can't serve.",
  },
  admin: {
    label: "Plan worship",
    description:
      "For the people who plan worship. Set up teams and positions, plan services, and schedule people.",
  },
} as const;

export const FEATURE_COPY = {
  name: "Worship",
  description:
    "Lets your congregation set up worship teams, plan services on the calendar, and ask people to serve. Turning this off hides every worship page and stops requests and reminders. Nothing is deleted.",
} as const;

export const PERMISSION_COPY = {
  "worship.manage": "Set up worship teams, their positions and who can fill them, and save service types",
  "worship.plan": "Add, change and cancel worship services and choose which teams serve",
  "worship.schedule": "Schedule people into worship positions, send requests, and record answers for them",
} as const;

export const TEMPLATE_ROLE_NAME = "Worship Leader";

export const PLATFORM_ADMIN_LABELS = {
  "worship.manage": "worship teams",
  "worship.plan": "worship services",
  "worship.schedule": "worship scheduling",
} as const;

// ---------------------------------------------------------------------------
// G2 - gate and error states (both trees)
// ---------------------------------------------------------------------------

export const GATE_COPY = {
  off: (orgName: string) => `Worship isn't turned on for ${orgName} yet.`,
  offLink: "Turn it on under Features",
  offAsk: (orgName: string) => `Ask someone who manages ${orgName}'s features to turn it on.`,
  notApplicable: "Worship planning is for congregations and new worshiping communities.",
  forbidden: (orgName: string) =>
    `You don't have permission to plan worship at ${orgName}. If you think this is a mistake, ask your stated clerk or another administrator there.`,
  loadError: "We couldn't load worship right now. Try again in a moment.",
  closedRequest: {
    heading: "This request is no longer open",
    body: "The service was cancelled, it has already started, or the request was taken back. Your other requests are on your schedule.",
    link: "Go to my schedule",
  },
} as const;

export const ACTION_COPY = {
  generic: "We couldn't save that. Try again.",
  forbidden: "You don't have permission to do that.",
  stale: "That has changed. Refresh the page and try again.",
  serviceStarted: "That service has already started.",
  serviceCancelled: "That service was cancelled.",
  notOnTeam: (name: string) => `${name} is no longer on this team.`,
  teamRetired: (team: string) => `${team} has been retired.`,
  /** "{team} is still scheduled for {n} upcoming services. Remove those people first." (the same shape for a position). */
  inUse: (name: string, n: number) =>
    `${name} is still scheduled for ${n} upcoming ${plural(n, "service", "services")}. Remove those people first.`,
  roleBound: "This team's people receive a role, so only someone who manages groups can change who is on it.",
  sendNothing: "There's nothing to send. Add people first.",
  sendMailUnavailable: "We couldn't send requests right now. Nothing was changed.",
  sendOverCap: "You can send up to 200 requests at once. Send fewer, then send again.",
} as const;

// ---------------------------------------------------------------------------
// G3 - teams (admin tree)
// ---------------------------------------------------------------------------

export const HUB_COPY = {
  heading: "Plan worship",
  cards: {
    services: {
      title: "Services",
      description: "Add Sunday services and other services, and see who is scheduled.",
    },
    teams: { title: "Teams", description: "Set up teams, their positions, and who can fill them." },
    serviceTypes: {
      title: "Service types",
      description: "Save the usual time, place and teams for a kind of service.",
    },
  },
} as const;

export const TEAMS_COPY = {
  listHeading: "Worship teams",
  newButton: "New team",
  listEmpty: "No worship teams yet. Start with a ready-made team or make your own.",
  rowCounts: (people: number, positions: number) => `${people} ${plural(people, "person", "people")}, ${positions} ${plural(positions, "position", "positions")}`,
  retiredBadge: "Retired",
  form: {
    nameLabel: "Team name",
    kindLabel: "Kind",
    kindOptions: { team: "Team", choir: "Choir" },
    startWithLabel: "Start with",
    submit: "Create team",
    toast: "Team created.",
    existingLabel: "Or use a group you already have",
    existingSubmit: "Use this group",
    existingToast: "Team created.",
  },
  page: {
    positionsHeading: "Positions",
    peopleHeading: "People",
    positionNameLabel: "Position name",
    slotsLabel: "How many people",
    addPosition: "Add position",
    positionAdded: "Position added.",
    rename: "Rename",
    changeNumber: "Change number",
    retire: "Retire",
    addPersonLabel: "Add a person",
    searchPlaceholder: "Search by name",
    addPerson: "Add",
    personAdded: "Added to the team.",
    removeFromTeam: "Remove from team",
    canFillLabel: "Can fill:",
    saveQualifications: "Save",
    qualificationsSaved: "Saved.",
    leaderBadge: "Leader",
    chairBadge: "Chair",
    seatNote:
      "Chairs and leaders are chosen under Groups. A chair or leader can schedule people for this team and, where reimbursements are in use and your treasurer has allowed requests for this group, can approve them.",
  },
  removeDialog: {
    title: (name: string, team: string) => `Remove ${name} from ${team}?`,
    body: "They stay on record and are no longer offered for this team. Anything they're already scheduled for stays as it is.",
    confirm: "Remove",
    cancel: "Cancel",
    toast: "Removed from the team.",
  },
  retireTeamDialog: {
    title: (team: string) => `Retire ${team}?`,
    body: "It stops appearing when you plan services. Its people and past schedules stay on record.",
    confirm: "Retire team",
    cancel: "Cancel",
    toast: "Team retired.",
  },
  retirePositionDialog: {
    title: (position: string) => `Retire ${position}?`,
    body: "It stops being offered. People already scheduled for it stay as they are.",
    confirm: "Retire position",
    cancel: "Cancel",
    toast: "Position retired.",
  },
  validation: {
    nameRequired: "Enter a name.",
    nameTooLong: "Names can be up to 80 characters.",
    positionNameTooLong: "Position names can be up to 60 characters.",
    positionDuplicate: (name: string) => `You already have a position called ${name} on this team.`,
    slotsRange: "Choose a number from 1 to 20.",
    positionLimit: "A team can have up to 40 positions.",
    notOnRoll: (orgName: string) => `Only people with a current record at ${orgName} can be added to a team.`,
    seatsUnderGroups: "Chairs and leaders are changed under Groups.",
  },
  /**
   * Replaces "This is descriptive only - it does not grant software access." under the role select on the
   * Groups add-member form (Batch 6 coordinator item 5): that sentence stopped being true when a chair or
   * leader gained scheduling (and, earlier, reimbursement approval). Reviewed in Phase 3 amendment 3 (G9).
   */
  groupsRoleNote:
    "Member, Chair and Leader describe a person's part in the group. If the group has been given a role, everyone in it gets that role, whatever their part.",
  /** The helper line under the role select on the Groups add-member form. */
  groupsHelper:
    "A chair or leader can also schedule people when this group is a worship team, and can approve this group's reimbursement requests when your treasurer allows requests for it.",
} as const;

// ---------------------------------------------------------------------------
// G4 - service types and services (admin tree)
// ---------------------------------------------------------------------------

export const SERVICES_COPY = {
  types: {
    heading: "Service types",
    empty: "No service types yet. Save the usual time, place and teams for a kind of service, such as Sunday worship.",
    nameLabel: "Name",
    startsAtLabel: "Starts at",
    lastsLabel: "Lasts (minutes)",
    whereLabel: "Where",
    teamsLabel: "Teams that usually serve",
    submit: "Save service type",
    toast: "Service type saved.",
    /** NOT in the Phase 3 Copy table (a duplicate name needed a sentence); flagged in the Batch 2 notes. */
    duplicate: (name: string) => `You already have a service type called ${name}.`,
    retireDialog: {
      title: (name: string) => `Retire ${name}?`,
      body: "It stops being offered when you add services. Services already added stay as they are.",
      confirm: "Retire service type",
      toast: "Service type retired.",
    },
  },
  list: {
    heading: "Services",
    tabUpcoming: "Coming up",
    tabEarlier: "Earlier",
    addOne: "Add a service",
    addSeveral: "Add several services",
    filled: (filled: number, needed: number) => `${filled} of ${needed} positions filled`,
    waiting: (n: number) => `${n} waiting for an answer`,
    cancelledBadge: "Cancelled",
    empty: "No services yet. Add this Sunday's service to start scheduling.",
  },
  form: {
    titleLabel: "Title",
    dateLabel: "Date",
    startsAtLabel: "Starts at",
    endsAtLabel: "Ends at (optional)",
    whereLabel: "Where (optional)",
    teamsLabel: "Teams that serve",
    submit: "Add service",
    toast: "Service added.",
    duplicate: (title: string) => `There's already a service at that time: ${title}.`,
    duplicateConfirm: "Add it anyway",
    duplicateCancel: "Cancel",
  },
  several: {
    typeLabel: "Service type",
    firstDateLabel: "First date",
    repeatLabel: "Repeat",
    repeatOptions: { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly (same date)" },
    countLabel: "How many",
    submit: "Add services",
    toast: (n: number) => `${n} ${plural(n, "service", "services")} added.`,
    tooMany: "You can add up to 26 at a time.",
  },
  page: {
    editDetails: "Edit details",
    cancelService: "Cancel service",
    teamsServingHeading: "Teams serving",
    addTeam: "Add a team",
    removeTeam: "Remove",
    cancelledBadge: "Cancelled",
    editToast: "Service updated.",
  },
  cancelDialog: {
    title: "Cancel this service?",
    body: "It is marked Cancelled in your services list and leaves the calendar. We email the people who were asked or scheduled, where we have an address for them, and open requests are closed. Their schedule stays on record.",
    confirm: "Cancel service",
    keep: "Keep it",
    toast: "Service cancelled.",
  },
} as const;

// ---------------------------------------------------------------------------
// G5 - board, picker, Send
// ---------------------------------------------------------------------------

export const BOARD_COPY = {
  positionBlock: (position: string, filled: number, slots: number) => `${position}, ${filled} of ${slots}`,
  openRow: "Open",
  addSomeone: "Add someone",
  addGuest: "Add a guest",
  guestNameLabel: "Guest name",
  guestHint: "Just a name. Contact details aren't kept here.",
  chips: {
    draft: "Not sent yet",
    requested: "Waiting for an answer",
    confirmed: "Confirmed",
    declined: "Declined",
    declinedWithReason: (reason: Reason) => `Declined: ${REASON_LABELS[reason]}`,
    guest: "Guest",
  },
  reach: {
    emailed: "Request emailed.",
    guardian: "No email sent: may be under 18. Ask a parent or guardian, then record their answer.",
    noAddress: "No email sent: no email address on file.",
    doNotContact: "No email sent: marked do not contact.",
  },
  picker: {
    title: (position: string) => `Add someone to ${position}`,
    canFill: "Can fill this position",
    notMarked: "Not marked for this position",
    cantServeOn: (date: string) => `Can't serve on ${date}`,
    alreadyScheduled: (position: string) => `Already scheduled as ${position} that day`,
    overlaps: (title: string) => `Overlaps ${title}`,
    declinedThis: "Said they can't serve this service",
    mayBeUnder18: "May be under 18. They won't get an email.",
    add: "Add",
    addAnyway: "Add anyway",
    showEveryone: "Show everyone on the team",
    empty: "No one on this team is marked for this position yet.",
    toast: "Added. Send requests when you're ready.",
  },
  record: {
    title: (name: string) => `Record ${name}'s answer`,
    accepted: "Accepted",
    declined: "Declined",
    reasonLabel: "Reason (optional)",
    helper: "This is saved as entered by you.",
    submit: "Record answer",
    toast: "Answer recorded.",
    recordedBy: (name: string) => `Recorded by ${name}`,
  },
  removeDialog: {
    title: (name: string, position: string) => `Remove ${name} from ${position}?`,
    bodyDraft: "They haven't been asked yet.",
    bodySent: "They stay on record. They aren't sent a message about this, so let them know yourself.",
    confirm: "Remove",
    cancel: "Cancel",
    toast: "Removed.",
  },
  send: {
    button: (n: number) => `Send requests (${n})`,
    title: (n: number) => `Send ${n} ${plural(n, "request", "requests")}?`,
    body: (cannot: number, minors: number, noAddress: number, doNotContact: number) =>
      `Each person gets one email listing their positions and dates. ${cannot} can't be emailed (${minors} may be under 18, ${noAddress} have no email address, ${doNotContact} are marked do not contact). For them, record their answer yourself.`,
    /** The body when everyone can be emailed. */
    bodyAllReachable: "Each person gets one email listing their positions and dates.",
    confirm: "Send requests",
    cancel: "Cancel",
    toast: (emailed: number, notEmailed: number) => `Requests sent. ${emailed} emailed, ${notEmailed} not emailed.`,
  },
} as const;

// ---------------------------------------------------------------------------
// G6 - member pages
// ---------------------------------------------------------------------------

export const MEMBER_COPY = {
  home: {
    heading: "Worship",
    waiting: "Waiting for your answer",
    scheduled: "You're scheduled",
    declined: "You said you can't serve",
    teams: "Your teams",
    youLead: "You lead",
    blockoutsLink: "Dates I can't serve",
    empty: "You're not asked to serve at any upcoming services. When someone asks you, it appears here.",
    card: (position: string, team: string) => `${position}, ${team}`,
    cancelled: "Service cancelled",
    accept: "Accept",
    decline: "Decline",
    serveAfterAll: "I can serve after all",
  },
  request: {
    heading: "Your request to serve",
    body: (orgName: string, position: string, team: string, date: string) =>
      `${orgName} asks you to serve as ${position} with ${team} on ${date}.`,
    where: (location: string) => `Where: ${location}`,
    confirmed: "You're confirmed.",
    declined: "You said you can't serve.",
    reasonLabel: "Reason (optional)",
    reasonHelper: "People who schedule worship can see this.",
    reasonOptions: REASON_LABELS,
    toastConfirmed: (position: string, date: string) => `You're confirmed for ${position} on ${date}.`,
    toastDeclined: "Thanks for letting us know. You're not scheduled for that date.",
  },
  blockouts: {
    heading: "Dates I can't serve",
    helper:
      "People who schedule worship are told when you've saved a date they're choosing for, but they don't see your reason. Saving dates doesn't cancel anything you've already agreed to.",
    fromLabel: "From",
    toLabel: "To",
    reasonLabel: "Reason (optional)",
    submit: "Save dates",
    row: (from: string, to: string, reason: Reason | null) =>
      reason ? `${from} to ${to}, ${REASON_LABELS[reason]}` : `${from} to ${to}`,
    remove: "Remove",
    empty: "You haven't saved any dates.",
    toastSaved: "Dates saved.",
    toastMerged: "Saved. We joined it with dates you'd already saved.",
    toastRemoved: "Dates removed.",
    endBeforeStart: "The end date can't be before the start date.",
    inPast: "Choose dates that haven't passed.",
    tooLong: "Choose dates within a year.",
    tooMany: "You can save up to 50 sets of dates. Remove some you no longer need.",
    conflict: (date: string) =>
      `You're already confirmed to serve on ${date}. This doesn't change that. Let the person who asked you know.`,
  },
  team: {
    leaders: "Leaders",
    people: "People",
    canFill: (positions: string[]) => `Can fill: ${positions.join(", ")}`,
    upcoming: "Upcoming services",
    schedule: "Schedule this team",
    empty: "No one is on this team yet.",
  },
} as const;

// ---------------------------------------------------------------------------
// Navigation and page chrome. NOT in the Phase 3 Copy table (the table names the
// controls and states, not the back links and one-line page descriptions every
// page needs); added in Batches 4 and 5 and listed in the work-log for the
// Phase 6 copy read and a fork's branding pass.
// ---------------------------------------------------------------------------

export const NAV_COPY = {
  tryAgain: "Try again",
  backToWorship: "Back to Worship",
  backToPlan: "Back to Plan worship",
  backToTeams: "Back to Worship teams",
  backToServiceTypes: "Back to Service types",
  backToServices: "Back to Services",
  /** "Back to {team}" on a board opened from a team page. */
  backToTeam: (team: string) => `Back to ${team}`,
  noServices: "No services are coming up for this team.",
  loadingCandidates: "Loading...",
  candidatesError: "We couldn't load that. Try again.",
  saving: "Saving...",
  cancel: "Cancel",
  save: "Save",
  edit: "Edit",
  guestSubmit: "Add guest",
  searchNone: "No one matches that search. People already on this team, and people without a current record, aren't listed.",
  slotsCount: (n: number) => `${n} ${n === 1 ? "person" : "people"}`,
  newServiceType: "New service type",
  editServiceType: "Edit service type",
  noPositions: "This team has no positions yet.",
  noServingTeams: "No teams are serving yet.",
  noServiceTypesTitle: "No service types yet.",
  noServiceTypesToUse: "Someone who sets up worship needs to save a service type first. Then you can add several services here.",
  noTeamsToAdd: "Every team is already serving.",
  chooseOne: "Choose one",
  teamNone: "No teams yet. When a team has been made, you can choose it here.",
  /** "{n} min" next to a service type's usual length. */
  minutes: (n: number) => `${n} min`,
} as const;

// ---------------------------------------------------------------------------
// G7 - emails (plain text plus the standard layout; no name of any person, no free text)
// ---------------------------------------------------------------------------

/** "and {n} more" after the first twelve lines of a request email. */
export const EMAIL_LINE_CAP = 12;

export const EMAIL_COPY = {
  request: {
    subject: (org: string) => `${org}: a request to serve`,
    heading: "You're asked to serve",
    intro: (org: string) => `${org} is asking you to serve:`,
    more: (n: number) => `and ${n} more`,
    buttonOne: "Answer the request",
    buttonMany: "Answer your requests",
    footnote: "You need to sign in to answer. If you can't, let whoever asked you know.",
  },
  reminderWaiting: {
    subject: (org: string) => `${org}: please answer your request`,
    heading: "A request is waiting for your answer",
    body: (date: string, position: string, team: string) =>
      `You were asked to serve on ${date}: ${position}, ${team}. Please answer so the team can plan.`,
    button: "Answer the request",
    footnote: "You need to sign in to answer. If you can't, let whoever asked you know.",
  },
  reminderConfirmed: {
    subject: (org: string) => `${org}: you're serving soon`,
    heading: "You're serving soon",
    button: "See your schedule",
    footnote: "Can't make it any more? Open your schedule and choose Decline, or tell your team leader.",
  },
  cancelled: {
    subject: (org: string) => `${org}: a service was cancelled`,
    heading: "A service was cancelled",
    body: (date: string) => `The service on ${date} was cancelled, so you are not serving that day.`,
    button: "See your schedule",
  },
  declined: {
    subject: (org: string) => `${org}: a position needs someone else`,
    heading: "Someone can't serve",
    body: (position: string, date: string) => `Someone you scheduled has declined ${position} on ${date}.`,
    button: "Open the schedule",
    footnote: "This message doesn't include their name. Open the schedule to see who.",
  },
} as const;

// ---------------------------------------------------------------------------
// G8 - the Features warning
// ---------------------------------------------------------------------------

export const FEATURES_WARNING_COPY = {
  title: "People are scheduled for upcoming services",
  description: (n: number) =>
    `${n === 1 ? "1 person is" : `${n} people are`} asked or scheduled for upcoming services. Turning this off hides the schedule and stops requests and reminders. People who were asked can't answer until you turn it back on. Nothing is deleted.`,
  fallbackTitle: "People may be scheduled for upcoming services",
  fallbackDescription:
    "We couldn't check who is scheduled just now. Turning this off hides the schedule and stops requests and reminders. Nothing is deleted.",
} as const;
