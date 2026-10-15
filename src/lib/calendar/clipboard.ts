/**
 * "Copy month": the rich-text and plain-text forms of one month's calendar, for
 * pasting into a bulletin, newsletter or email. Pure — the browser only writes
 * the two strings it is handed to the clipboard.
 *
 * What is copied is a PUBLIC-facing artifact, so:
 *   - rows that are not public (`isPublic` false = "members only") or are
 *     cancelled are dropped HERE, server-side, so a dropped row's title never
 *     reaches the browser at all;
 *   - the output carries NO organization name, address, phone, id, URL,
 *     `/o/<slug>` path, description, creator, type name or colour;
 *   - the HTML has no colour anywhere (a pasted table must read in any mail
 *     client and survive being printed in black and white);
 *   - every interpolated string passes through `escapeHtml`.
 *
 * Days outside the month show as bare day numbers with no entries — they belong
 * to the neighbouring month's copy. A multi-day or before-grid event appears
 * once, on its START day.
 */
import { escapeHtml } from "@/lib/email/escape-html";
import {
  WEEKDAY_ABBREVIATIONS,
  buildMonthGrid,
  formatClipboardDay,
  isSameMonth,
  monthLabel,
  monthOfDayKey,
  type MonthRef,
} from "./month";
import { formatTimeCompact } from "./wall-clock";

export interface ClipboardEntry {
  dayKey: string;
  startsAtWallClock: string;
  title: string;
  location: string | null;
  isPublic: boolean;
  isCancelled?: boolean;
}

export interface MonthClipboard {
  html: string;
  text: string;
  /** In-month entries dropped for being non-public or cancelled. */
  leftOutCount: number;
  /** In-month entries kept. */
  includedCount: number;
}

/** One-line, single-spaced: a title or location with a newline must not break the text layout. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function entryLine(entry: ClipboardEntry): string {
  const where = entry.location ? oneLine(entry.location) : "";
  const base = `${formatTimeCompact(entry.startsAtWallClock)} ${oneLine(entry.title)}`;
  return where ? `${base} - ${where}` : base;
}

export function buildMonthClipboard(
  month: MonthRef,
  entries: readonly ClipboardEntry[],
): MonthClipboard {
  const inMonth = entries.filter((e) =>
    isSameMonth(monthOfDayKey(e.dayKey), month),
  );
  const kept = inMonth
    .filter((e) => e.isPublic && !e.isCancelled)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      a.entry.startsAtWallClock < b.entry.startsAtWallClock
        ? -1
        : a.entry.startsAtWallClock > b.entry.startsAtWallClock
          ? 1
          : a.index - b.index,
    )
    .map(({ entry }) => entry);

  const byDay = new Map<string, ClipboardEntry[]>();
  for (const entry of kept) {
    const list = byDay.get(entry.dayKey);
    if (list) list.push(entry);
    else byDay.set(entry.dayKey, [entry]);
  }

  const heading = monthLabel(month);

  // ---- HTML ---------------------------------------------------------------
  const grid = buildMonthGrid(month);
  const cell = "vertical-align:top;padding:4px;width:14%;font-family:sans-serif;font-size:13px";
  const headerCells = WEEKDAY_ABBREVIATIONS.map(
    (name) => `<th style="${cell};text-align:left">${escapeHtml(name)}</th>`,
  ).join("");
  const rows = grid.weeks
    .map((week) => {
      const cells = week
        .map((day) => {
          if (!day.inMonth) {
            return `<td style="${cell}">${day.day}</td>`;
          }
          const lines = (byDay.get(day.key) ?? [])
            .map((e) => `<div>${escapeHtml(entryLine(e))}</div>`)
            .join("");
          return `<td style="${cell}"><strong>${day.day}</strong>${lines}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  // An HTML STRING for the clipboard (pasted into email and bulletins), never rendered by React.
  // ui-ok: clipboard HTML string, not an in-app table
  const tableOpen = `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%">`;
  const html =
    `<h2>${escapeHtml(heading)}</h2>` +
    tableOpen +
    `<thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;

  // ---- Plain text ---------------------------------------------------------
  const blocks = [...byDay.keys()]
    .sort()
    .map((dayKey) => {
      const lines = byDay.get(dayKey)!.map((e) => `  ${entryLine(e)}`);
      return [formatClipboardDay(dayKey), ...lines].join("\n");
    });
  const text =
    blocks.length === 0
      ? `${heading}\n\n`
      : `${heading}\n\n${blocks.join("\n\n")}\n`;

  return {
    html,
    text,
    leftOutCount: inMonth.length - kept.length,
    includedCount: kept.length,
  };
}

/**
 * 'Calendar copied' | 'Calendar copied (2 members-only events left out)' |
 * 'Calendar copied (Worship only)' |
 * 'Calendar copied (1 members-only event left out; Worship only)'.
 */
export function copiedMessage(
  leftOutCount: number,
  filterLabel: string | null,
): string {
  const notes: string[] = [];
  if (leftOutCount > 0) {
    notes.push(
      `${leftOutCount} members-only event${leftOutCount === 1 ? "" : "s"} left out`,
    );
  }
  if (filterLabel) notes.push(filterLabel);
  return notes.length > 0
    ? `Calendar copied (${notes.join("; ")})`
    : "Calendar copied";
}
