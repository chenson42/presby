import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarCog, CalendarPlus } from "lucide-react";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, OrgAccessError, resolveOrgContext } from "@/lib/authz";
import { getMonthCalendar, type MonthCalendarData } from "@/lib/calendar";
import { buildMonthClipboard } from "@/lib/calendar/clipboard";
import {
  buildCalendarHref,
  describeTypeFilter,
  parseTypesParam,
  parseViewParam,
} from "@/lib/calendar/filters";
import { buildMonthGrid, monthLabel, parseMonthParam } from "@/lib/calendar/month";
import { isFlagEnabled } from "@/lib/flags";
import { ButtonGroup } from "@/components/shared/button-group";
import { Button } from "@/components/ui/button";
import { OrgAccessDenied, OrgAccessEnded } from "../org-states";
import { CalendarDisabled, CalendarForbidden, CalendarLoadError } from "./calendar-states";
import { CalendarFilters } from "./calendar-filters";
import { CopyMonthButton } from "./copy-month-button";
import { MonthGridView } from "./month-grid";
import { MonthListView } from "./month-list";
import { MonthNav } from "./month-nav";

const EVENTS_FLAG = "org_portal.events";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * `/o/<slug>/calendar?month&types&view` - the member calendar (docs/work-log/
 * 2026-10-14-member-calendar.md). Repeats the `(org)` auth pattern in full:
 * the auth check lives in the page, not the layout, so a signed-out visitor
 * keeps their deep link.
 *
 * Gate order: sign-in -> the four-way org miss -> `assertOrgAccess` ->
 * `getMonthCalendar` (calendar toggle, then `events.view` or `events.manage`).
 * No flag: the calendar is toggle-only. `org_portal.events` is read only to
 * decide whether the admin links render.
 *
 * NO `loading.tsx` on this segment, by design: the calendar renders states and
 * the detail segment calls `notFound()`, and a `loading.tsx` would flush a 200
 * before either resolves. `/o/[slug]/error.tsx` catches an unexpected throw.
 *
 * Garbage `?month=`, `?types=` and `?view=` degrade to the current month, All,
 * and the month view - never an error.
 */
export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const requestedMonth = parseMonthParam(sp.month);
  const requestedTypeIds = parseTypesParam(sp.types);
  const view = parseViewParam(sp.view);

  const session = await cachedAuth();
  if (!session?.user) {
    // The REBUILT canonical href, never the raw query.
    const callback = buildCalendarHref(slug, {
      month: requestedMonth,
      types: requestedTypeIds,
      view,
    });
    redirect(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  }

  const resolved = await resolveOrgContext(session.user.id, slug);

  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return (
        <OrgAccessDenied
          name={resolved.name}
          organizationType={resolved.organizationType}
          slug={slug}
        />
      );
    case "ended":
      return <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />;
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const orgName = resolved.org.name;
  const retryHref = buildCalendarHref(slug, {
    month: requestedMonth,
    types: requestedTypeIds,
    view,
  });

  let result;
  try {
    result = await getMonthCalendar(resolved.org.personId, resolved.org.organizationId, {
      month: requestedMonth ?? undefined,
      requestedTypeIds,
    });
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <CalendarLoadError retryHref={retryHref} />;
  }

  if (result.kind === "disabled") return <CalendarDisabled name={orgName} />;
  if (result.kind === "forbidden") return <CalendarForbidden name={orgName} />;

  const data: MonthCalendarData = result.data;

  let showAdminLinks = false;
  if (data.canManage) {
    try {
      showAdminLinks = await isFlagEnabled(EVENTS_FLAG);
    } catch {
      showAdminLinks = false;
    }
  }

  const { month, activeTypeIds, types } = data;
  const monthText = monthLabel(month);
  const hrefFor = (state: { month: typeof month | null }) =>
    buildCalendarHref(slug, { month: state.month, types: activeTypeIds, view });
  const fromHref = hrefFor({ month });
  const todayHref = hrefFor({ month: null });

  const orgIsEmpty = data.unfilteredInMonthCount === 0 && !data.orgHasEvents;
  const monthIsEmpty = data.unfilteredInMonthCount === 0 && data.orgHasEvents;
  const filtersHideAll = data.unfilteredInMonthCount > 0 && data.inMonthCount === 0;

  const grid = buildMonthGrid(month);
  const selectedNames = types.filter((t) => activeTypeIds.includes(t.id)).map((t) => t.name);
  const clipboard = buildMonthClipboard(
    month,
    data.entries.map((e) => ({
      dayKey: e.dayKey,
      startsAtWallClock: e.startsAtWallClock,
      title: e.title,
      location: e.location,
      isPublic: e.isPublic,
    })),
  );

  const header = (
    <div>
      <h1 className="text-2xl font-semibold">Calendar</h1>
      <p className="mt-1 text-sm text-muted-foreground">{orgName}</p>
    </div>
  );

  if (orgIsEmpty) {
    return (
      <section className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {header}
          {showAdminLinks && (
            <Button asChild variant="outline" className="min-h-11 self-start">
              <Link href={`/o/${slug}/admin/events`}>
                <CalendarCog className="size-4" aria-hidden />
                Manage events
              </Link>
            </Button>
          )}
        </div>
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          {showAdminLinks ? (
            <>
              <p className="text-base font-medium">{orgName} hasn&apos;t added any events yet.</p>
              <Button asChild className="mt-4 min-h-11">
                <Link href={`/o/${slug}/admin/events/new`}>Add an event</Link>
              </Button>
            </>
          ) : (
            <p className="text-base font-medium">
              When {orgName} adds events, they&apos;ll appear here.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {header}
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {showAdminLinks && (
            <>
              <Button asChild className="min-h-11">
                <Link href={`/o/${slug}/admin/events/new`}>
                  <CalendarPlus className="size-4" aria-hidden />
                  Add an event
                </Link>
              </Button>
              <Button asChild variant="outline" className="min-h-11">
                <Link href={`/o/${slug}/admin/events`}>
                  <CalendarCog className="size-4" aria-hidden />
                  Manage events
                </Link>
              </Button>
            </>
          )}
          <Button asChild variant="outline" className="min-h-11">
            <Link href={todayHref}>Today</Link>
          </Button>
          {data.inMonthCount > 0 && (
            <CopyMonthButton
              html={clipboard.html}
              text={clipboard.text}
              leftOutCount={clipboard.leftOutCount}
              filterLabel={describeTypeFilter(selectedNames)}
            />
          )}
        </div>
      </div>

      <MonthNav slug={slug} month={month} types={activeTypeIds} view={view} />

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between print:hidden">
        {types.length > 1 && (
          <CalendarFilters
            slug={slug}
            month={month}
            view={view}
            types={types}
            activeTypeIds={activeTypeIds}
          />
        )}
        <ButtonGroup
          aria-label="Calendar view"
          className="hidden md:inline-flex"
          items={[
            {
              key: "month",
              label: "Month",
              href: buildCalendarHref(slug, { month, types: activeTypeIds, view: "month" }),
              active: view === "month",
              "aria-current": view === "month" ? "page" : undefined,
            },
            {
              key: "list",
              label: "List",
              href: buildCalendarHref(slug, { month, types: activeTypeIds, view: "list" }),
              active: view === "list",
              "aria-current": view === "list" ? "page" : undefined,
            },
          ]}
        />
      </div>

      {monthIsEmpty && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-base font-medium">Nothing is scheduled for {monthText}.</p>
        </div>
      )}

      {filtersHideAll && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-base font-medium">No events match these event types.</p>
          <Button asChild variant="outline" className="mt-4 min-h-11">
            <Link href={buildCalendarHref(slug, { month, types: [], view })}>
              Show all event types
            </Link>
          </Button>
        </div>
      )}

      {data.inMonthCount > 0 && (
        <>
          <MonthGridView
            slug={slug}
            month={month}
            grid={grid}
            entries={data.entries}
            todayKey={data.todayKey}
            view={view}
            fromHref={fromHref}
          />
          <MonthListView
            slug={slug}
            month={month}
            entries={data.entries}
            todayKey={data.todayKey}
            view={view}
            fromHref={fromHref}
          />
        </>
      )}
    </section>
  );
}
