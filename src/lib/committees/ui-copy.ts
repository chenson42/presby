/**
 * The page chrome of the committees pages: headings, buttons, field labels,
 * helper lines and empty states (docs/work-log/2026-11-19-presbytery-committees.md,
 * Phase 3 "Copy", C2 to C8). PURE, no imports: a page, a form and `copy.test.ts`
 * read one file. `copy.ts` holds the strings the server module produces (refusals,
 * validator messages, toasts, the notes); this file holds the words around them.
 *
 * A string that is not in the design's Copy section does not belong here: it stops
 * for a ruling. A date inside a sentence is composed by the caller (`dateText`, or
 * `FormattedDate` where a sentence is split in two pieces).
 */

export const AREA = "Committees & Commissions";
export const BACK_TO_COMMITTEES = "Back to committees";
export const backTo = (name: string) => `Back to ${name}`;

// C2: the list
export const LIST = {
  intro: (name: string) => `The committees of ${name}, and who serves on each.`,
  newCommittee: "New committee",
  sections: {
    required: "Required committees",
    standing: "Standing committees",
    ad_hoc: "Ad hoc committees",
    unlabelled: "Not yet labelled",
    dissolved: "Dissolved committees",
  },
  unlabelledNote:
    "No label has been chosen for these committees yet. Open each one and choose Required, Standing or Ad hoc.",
  tableHead: { name: "Name", chair: "Chair", serving: "Serving", meets: "Meets" },
  meets: (when: string) => `Meets ${when}`,
  showDissolved: (n: number) => `Show dissolved committees (${n})`,
  hideDissolved: "Hide dissolved committees",
  dissolvedOn: "Dissolved",
  emptyTitle: "No committees yet",
  emptyBody:
    "Start with the committees your presbytery is required to have, then add standing and ad hoc ones as you need them.",
  emptyAction: "Create your first committee",
} as const;

// C3: the committee page
export const PAGE = {
  edit: "Edit committee",
  addMember: "Add a member",
  dissolve: "Dissolve committee",
  dissolvedBefore: "This committee was dissolved on ",
  dissolvedAfter: ". Its roster is kept here as history.",
  headings: { serving: "Serving now", planned: "Starting later", past: "Past members" },
  emptyRoster: "No one serves on this committee yet.",
  notLabelled: "Not yet labelled",
  dissolvedBadge: "Dissolved",
  changeRole: "Change role",
  public: "Public",
  tableHead: { name: "Name", role: "Role", dates: "Dates", actions: "Actions" },
} as const;

// C4: create and edit
export const FORM = {
  newTitle: "New committee",
  editTitle: (name: string) => `Edit ${name}`,
  name: "Committee name",
  kind: "Kind",
  kindChoose: "Choose one",
  kindHelper:
    "Required: a committee your presbytery has to have. Standing: ongoing from year to year. Ad hoc: formed for one task.",
  purpose: "Purpose (optional)",
  meetsWhen: "When it meets (optional)",
  create: "Create committee",
  save: "Save changes",
  cancel: "Cancel",
  saving: "Saving…",
} as const;

// C5: add a member
export const ADD = {
  title: (committee: string) => `Add a member to ${committee}`,
  person: "Person",
  personChoose: "Choose a person",
  alreadyServes: (name: string) => `${name} (already serves)`,
  personHelper:
    "Don't see them? People serve on a committee from the presbytery's own records, so add them under Community first. If you don't see Community, ask your presbytery's administrator.",
  role: "Role",
  roleHelper:
    "Ex officio means serving because of another office. It is entered by hand and doesn't change if that office changes hands.",
  startsOn: "Starts on",
  startsHelper: "The first day they serve. A later date plans an appointment ahead of time.",
  endsOn: "Ends on (optional)",
  endsHelper: "The first day they are no longer on the committee. Leave it empty if the term has no set end.",
  submit: "Add to committee",
  emptyTitle: "No one is available to add",
  emptyBody: (presbytery: string) =>
    `People serve on a committee from the presbytery's own records, so add them under Community first. If Community is off for ${presbytery}, turn on "Community: add people and record roll actions" under Features. If you don't see Community or Features, ask your presbytery's administrator.`,
} as const;

// C6: change a role
export const CHANGE = {
  title: (name: string) => `Change ${name}'s role`,
  newRole: "New role",
  // Not in the ratified Copy section: the placeholder option of the New role select (recorded as a B3 deviation).
  chooseRole: "Choose a different role",
  effectiveOn: "Effective on",
  helper: "The new role starts on this date and the old role ends the same day, so there is no gap. Both stay in the history.",
  keepsEnd: (date: string) => `The new role keeps the same end date, ${date}.`,
  listed: (name: string) => `${name} is listed on the public website, and the new role title will show there.`,
  submit: "Change role",
} as const;

// C7: end a term
export const END = {
  titleEnd: (name: string) => `End ${name}'s term?`,
  titleChange: (name: string) => `Change when ${name}'s term ends`,
  titleCancel: (name: string) => `Cancel ${name}'s planned term?`,
  body: "Their name stays in the history of this committee, with its dates.",
  field: "Ends on",
  helper:
    "The first day they are no longer on the committee. To record their last day of service, enter the day after it.",
  confirmEnd: "End term",
  confirmChange: "Save end date",
  confirmCancel: "Cancel planned term",
  goBack: "Go back",
} as const;

// C8: dissolve
export const DISSOLVE = {
  title: (committee: string) => `Dissolve ${committee}?`,
  body: 'This ends every term on the committee on the date you choose and moves it to "Dissolved committees". No one can be added afterwards, and it can\'t be undone from this page. The roster is kept as history.',
  field: "Dissolved on",
  helper:
    "The first day the committee no longer exists. Everyone's term ends on this date. It can't be in the future.",
  confirm: "Dissolve committee",
  goBack: "Go back",
} as const;

// C10: the groups admin at a presbytery
export const GROUPS_POINTER = {
  before: "Committees of ",
  middle: " are kept under ",
  after: ".",
  emptyTitle: "No groups yet",
  emptyBody: "Add your first one to get started.",
} as const;
