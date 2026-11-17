/**
 * Every string the presbytery reports show, in one pure file - the Copy section
 * of docs/work-log/2026-11-15-presbytery-reports.md (Phase 3). PURE: no
 * imports. A string that is not here and not a reused existing component's
 * wording stops for a ruling. `copy.test.ts` pins three properties: no string
 * mentions two-factor (F445: the two tier-2 keys do not force it, so nothing
 * here may claim an export requires it), none contains the sentence the e2e
 * suite looks for on the existing page ("don't have permission to manage"),
 * and none uses a phrase `check:help` bans.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// ---------------------------------------------------------------------------
// Hub (a section on /o/<slug>/admin/reports)
// ---------------------------------------------------------------------------

export const HUB_COPY = {
  heading: "Reports and exports",
  intro:
    "Read each report on screen or download it as a CSV file for a spreadsheet. To enter statistics, set the per-capita rate or record payments, use the sections below.",
  rosterLine: (org: string) =>
    `The reports list the congregations that are members of ${org} today. New worshiping communities are not included.`,
  cards: {
    vacant_pulpits: {
      description: "Which congregations have no installed or designated pastor today.",
      source: "From the pastoral appointments recorded on Credentials.",
    },
    membership_trend: {
      description: "Ending active members, by congregation and year.",
      source: "From congregation statistics.",
    },
    viability: {
      description: (org: string) => `How ${org} rates each congregation, from at risk to healthy.`,
      source: "From Congregation Oversight.",
    },
    per_capita: {
      description: "What each congregation was billed for a year, has paid and still owes.",
      source: "From the rate and the bills in the Per-Capita section below.",
    },
  },
  lockedBadge: "Locked",
  lockedReason: (permissionPhrase: string) =>
    `You need permission to ${permissionPhrase}. An administrator can give it under Roles.`,
  helpLink: "Help with presbytery reports",
  loadError: "We couldn't check which reports you can open. Try again in a moment.",
  retry: "Try again",
} as const;

// ---------------------------------------------------------------------------
// Shared by every report page
// ---------------------------------------------------------------------------

export const FRAME_COPY = {
  back: "Back to reports",
  exportCsv: "Export CSV",
  exportAllYears: "Export all years",
  noMembers: "No member congregations on record",
  loadError: "We couldn't load this report right now. Try again in a moment.",
  retry: "Try again",
} as const;

// ---------------------------------------------------------------------------
// Vacant pulpits
// ---------------------------------------------------------------------------

export const VACANT_COPY = {
  title: "Vacant pulpits",
  subtitleLead: (org: string) => `Congregations of ${org} with no installed or designated pastor on`,
  count: (vacant: number, total: number) =>
    `${vacant} vacant of ${total} ${plural(total, "congregation", "congregations")}`,
  note1: "Based on the appointments recorded on Credentials. A congregation with no appointment recorded appears here.",
  note2: "Stated, interim and temporary supply do not count as a pastor here. They are shown under Supply.",
  columns: {
    congregation: "Congregation",
    vacantSince: "Vacant since",
    timeVacant: "Time vacant",
    supply: "Supply",
  },
  noEarlierPastor: "No earlier pastor on record",
  supplySince: (callTypeLabel: string) => `${callTypeLabel} since`,
  supplyNone: "None recorded",
  zeroAppointments: {
    title: "No pastoral appointments are recorded yet",
    body: "So vacancies can't be worked out. Record appointments on Credentials.",
    action: "Open Credentials",
  },
  noneVacant: {
    title: "No vacant pulpits",
    body: "Every congregation has an installed or designated pastor on record today.",
  },
  helpLink: "How to read vacant pulpits",
  export409: "There is nothing to export yet. No pastoral appointments are recorded.",
} as const;

/**
 * The three supply call types' wording, as the Credentials page spells them
 * (`CALL_TYPE_LABELS` in the credentials page's `credential-labels.ts`); a
 * lib file does not import from the app tree, so `copy.test.ts` pins that these
 * equal it.
 */
export const SUPPLY_CALL_TYPE_LABELS: Readonly<Record<string, string>> = {
  stated_supply: "Stated Supply",
  interim_pastor: "Interim Pastor",
  temporary_supply: "Temporary Supply",
};

// ---------------------------------------------------------------------------
// Membership trend
// ---------------------------------------------------------------------------

export const TREND_COPY = {
  title: "Membership trend",
  subtitle: (org: string, from: number, to: number) =>
    `Ending active members for each congregation of ${org}, ${from} to ${to}.`,
  earlier: "Earlier years",
  later: "Later years",
  windowLabel: (from: number, to: number) => `${from} to ${to}`,
  notMemberHidden: "Not a member that year",
  dash: "—",
  noData: "No data",
  notReported: "Not reported",
  columnCongregation: "Congregation",
  totalReported: "Total reported",
  reporting: (reporting: number, members: number) => `${reporting} of ${members} reporting`,
  note1: (org: string) =>
    `A dash means the congregation was not a member of ${org} that year. "No data" means it was a member and no statistics are on file. "Not reported" means statistics are on file without a figure for ending active members.`,
  note2:
    "Where a congregation reported its own figure, that figure is used. Congregations that have left are not shown.",
  nothing: {
    title: (from: number, to: number) => `No statistics recorded for ${from} to ${to}`,
    body: "Enter statistics for a congregation and year in the Congregation Statistics section.",
    action: "Record statistics",
  },
  helpLink: "How to read the membership trend",
} as const;

// ---------------------------------------------------------------------------
// Viability
// ---------------------------------------------------------------------------

export const VIABILITY_COPY = {
  title: "Viability",
  subtitle: (org: string) => `${org}'s own assessment of each congregation. At risk is 1 and Healthy is 3.`,
  columns: {
    congregation: "Congregation",
    viability: "Viability",
    notes: "Redevelopment notes",
    lastUpdated: "Last updated",
  },
  none: "—",
  assessNote: "Assess a congregation on Congregation Oversight.",
  assessLink: "Open Congregation Oversight",
  helpLink: "How to read viability",
} as const;

// ---------------------------------------------------------------------------
// Per capita
// ---------------------------------------------------------------------------

export const PER_CAPITA_COPY = {
  title: "Per capita",
  subtitle: (org: string, year: number) =>
    `What ${org} billed each congregation for ${year}, what has been paid and what is still owed.`,
  columns: {
    congregation: "Congregation",
    billed: "Billed",
    paid: "Paid",
    stillOwed: "Still owed",
    status: "Status",
  },
  total: "Total",
  credit: "credit",
  status: {
    unpaid: "Unpaid",
    partly_paid: "Partly paid",
    paid: "Paid",
    not_billed: "Not billed",
  },
  notBilled: {
    no_statistics: (basisYear: number | null) =>
      basisYear === null ? "No statistics on file" : `No statistics on file for ${basisYear}`,
    not_generated: "Not generated yet",
  },
  departed: "No longer a member",
  note: "Amounts are the bills generated in the Per-Capita section of Per-Capita, SASR & Imports.",
  empty: {
    title: (year: number) => `No per-capita bills for ${year}`,
    body: "Set a rate and generate the bills in the Per-Capita section of Per-Capita, SASR & Imports.",
    action: "Open Per-Capita, SASR & Imports",
  },
  helpLink: "How to read per capita",
} as const;

/** `$2,625.00`; a negative amount reads `$12.00 credit`. Integer cents only. */
export function formatDollars(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("formatDollars: cents must be a safe integer");
  const abs = Math.abs(cents);
  const dollars = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const text = `$${dollars}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `${text} ${PER_CAPITA_COPY.credit}` : text;
}

// ---------------------------------------------------------------------------
// Dashboard (/o/<slug>/admin/insights, presbytery) - DECISION-342
// ---------------------------------------------------------------------------

/** `1,234`; integers only, no locale (a server and a browser must agree). */
export function formatCount(n: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError("formatCount: n must be a safe integer");
  const text = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 ? `-${text}` : text;
}

/**
 * The dashboard's words. A card that already has a sentence in a report's copy
 * above reuses it by name where it is built (the view), not retyped here, so
 * the card and its report cannot drift. The strings below are the ones only
 * the dashboard says.
 */
export const DASHBOARD_COPY = {
  title: "Insights & Analytics",
  subtitle: (org: string) => `A quick look at the member congregations of ${org}. The reports have the full tables.`,
  pageError: "We couldn't load Insights & Analytics. Try again in a moment.",
  cardError: "We couldn't load this card. Try again in a moment.",
  helpLink: "Help with Insights & Analytics",
  forbidden: {
    body: "You don't have permission to see this page. It summarizes four reports, and each needs its own permission: manage statistics, manage credentials, manage per-capita billing and manage congregation oversight. Holding any one of them opens the page. An administrator can give a permission under Roles.",
  },
  empty: {
    title: "No member congregations yet",
    body: "Congregations appear here once they are members of this presbytery. The PresbyPortal team records membership.",
    action: "Contact the PresbyPortal team",
  },
  members: {
    title: "Member congregations",
    note: (org: string) =>
      `Congregations that are members of ${org} today. New worshiping communities and congregations that have left or closed are not counted.`,
    error: "We couldn't count the member congregations. Try again in a moment.",
  },
  trend: {
    title: "Ending active members",
    yearLine: (year: number, reporting: number, members: number) => `${year}: ${TREND_COPY.reporting(reporting, members)}`,
    partialNote: "Congregations that did not report a figure are not in the total.",
    noFigure: (year: number) => `Statistics are on file for ${year} without a figure for ending active members.`,
    link: (from: number, to: number) => `Open the trend for ${from} to ${to}`,
  },
  vacant: {
    title: "Vacant pulpits",
    link: "Open vacant pulpits",
    /** The credentials flag is off: the fact without the instruction to use a page that is not turned on. */
    notRecordedNoLink: "So vacancies can't be worked out.",
  },
  perCapita: {
    title: (year: number) => `Per capita, ${year}`,
    billed: "Billed",
    paid: (amount: string) => `Paid ${amount}`,
    stillOwed: (amount: string) => `Still owed ${amount}`,
    countLine: (billed: number, total: number) =>
      `${billed} of ${total} ${plural(total, "congregation", "congregations")} billed`,
    departed: (n: number) =>
      n === 1
        ? "Includes 1 congregation that is no longer a member."
        : `Includes ${n} congregations that are no longer members.`,
    link: (year: number) => `Open per capita for ${year}`,
    /** The reports flag is off: the fact without the instruction to use a section that is not turned on. */
    noRatePlain: (year: number) => `No rate is set for ${year}.`,
    rateSetPlain: (year: number) => `A rate is set for ${year}. The bills have not been generated.`,
    noRate: (year: number) =>
      `No rate is set for ${year}. Set one and generate the bills in the Per-Capita section of Per-Capita, SASR & Imports.`,
    rateSet: (year: number) =>
      `A rate is set for ${year}. Generate the bills in the Per-Capita section of Per-Capita, SASR & Imports.`,
  },
  viability: {
    title: VIABILITY_COPY.title,
    viewReport: "Open the viability report",
    error: "We couldn't load the viability list. Try again in a moment.",
  },
} as const;

// ---------------------------------------------------------------------------
// The congregation map (DECISION-343, docs/work-log/2026-11-17-presbytery-dashboard-map.md)
// ---------------------------------------------------------------------------

/**
 * The map's words. IMPORT-FREE (this file stays so), because the two client
 * files in `src/app/(org)/o/[slug]/admin/insights/` import it. No heading here may
 * contain a phrase another dashboard heading is matched by ("member
 * congregations", "viability", "vacant pulpits", "ending active members", "per
 * capita", "insights & analytics"): the e2e suite finds headings by substring.
 * The legend labels equal `VIABILITY_LABELS` and `VIABILITY_NOT_ASSESSED` in
 * `derive.ts` (a test pins that), so the legend and the list cannot drift.
 */
export const MAP_COPY = {
  title: "Congregation map",
  intro: (org: string) =>
    `Each pin is a member congregation of ${org} that has a location. Its shape shows its viability rating. The viability list below names every congregation.`,
  regionLabel: "Map of congregations that have a location. The viability list below gives the same ratings as text.",
  /** Noun by the total, verb by the count placed: "1 of 12 congregations has a location." */
  caption: (placed: number, total: number) =>
    `${placed} of ${total} ${plural(total, "congregation", "congregations")} ${plural(placed, "has", "have")} a location.`,
  legend: {
    heading: "Pin shapes",
    items: [
      { score: 1, label: "At risk", shape: "diamond" },
      { score: 2, label: "Fair", shape: "square" },
      { score: 3, label: "Healthy", shape: "circle" },
      { score: null, label: "Not yet assessed", shape: "hollow circle" },
    ],
  },
  popup: {
    rating: (label: string) => `Viability: ${label}`,
    open: "Open oversight page",
  },
  unplaced: {
    heading: "Not on the map",
    intro: "These congregations have no usable location.",
    entry: "Open a congregation to enter its latitude and longitude. Latitude comes first.",
  },
  /** The oversight flag is off: the fact, without an instruction to use a page that is not turned on. */
  oversightOff: (org: string) => `Locations are entered on Congregation Oversight, which isn't turned on for ${org} yet.`,
  empty: {
    title: "No congregation has a usable location yet.",
    entry: "Add a latitude and longitude on a congregation's Congregation Oversight page. Latitude comes first.",
    link: VIABILITY_COPY.assessLink,
  },
  /** The map read failed (with the retry link). Never worded as "no location". */
  readError: "We couldn't load the map. The list below has every congregation.",
  /** Tiles, the script chunk or Leaflet failed in the browser (no retry control). */
  tilesError: "The map could not load. The list below has every congregation. Reload the page to try again.",
  loading: "Loading the map…",
  attribution: {
    maptiler: "© MapTiler",
    maptilerHref: "https://www.maptiler.com/copyright/",
    osm: "© OpenStreetMap contributors",
    osmHref: "https://www.openstreetmap.org/copyright",
    logoAlt: "MapTiler logo",
    logoSrc: "https://api.maptiler.com/resources/logo.svg",
    logoHref: "https://www.maptiler.com/",
  },
} as const;

// ---------------------------------------------------------------------------
// Export routes (plain-text bodies)
// ---------------------------------------------------------------------------

export const ROUTE_COPY = {
  forbidden: "You don't have permission to export this report.",
  notFound: "Not found",
  gateFailed: "We can't check your access right now. Try again in a moment.",
  invalidYear:
    "That link has an invalid year. Use four-digit years from 1900 to 2100, and no more than 10 years in a trend.",
  invalidLink: "That link is not valid.",
  nothingToExport: VACANT_COPY.export409,
  exportFailed: "We can't prepare that file right now. Try again in a moment.",
} as const;

/** Every user-facing string above, flattened, for the copy tests. */
export function allCopyStrings(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      // Sample each template with representative arguments.
      const f = value as (...args: unknown[]) => unknown;
      for (const args of [["Northern Reach"], ["Northern Reach", 2021, 2025], [2025], [3, 9], [null], ["Interim Pastor"], ["manage statistics"], [2025, 9, 12]]) {
        try {
          const r = f(...args);
          if (typeof r === "string") out.push(r);
        } catch {
          /* arity mismatch */
        }
      }
    } else if (value && typeof value === "object") {
      for (const v of Object.values(value)) walk(v);
    }
  };
  for (const group of [HUB_COPY, FRAME_COPY, VACANT_COPY, TREND_COPY, VIABILITY_COPY, PER_CAPITA_COPY, DASHBOARD_COPY, MAP_COPY, ROUTE_COPY]) {
    walk(group);
  }
  return out;
}
