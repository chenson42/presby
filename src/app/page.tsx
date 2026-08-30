import Link from "next/link";
import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { PlatformMark, PlatformWordmark } from "@/components/brand/platform-mark";

/**
 * The four courts of Presbyterian polity, rendered as a minimal inline SVG —
 * the signature visual element of this page (commit 3 redo, docs/work-log/
 * 2026-08-27-platform-home-and-portal.md "Commit 3 correction"). Purely
 * decorative connective graphic (circles + a line, `stroke`/`fill`
 * `currentColor`) — `aria-hidden` because the courts themselves are named as
 * ordinary text immediately below it, not inside the SVG, so a screen reader
 * gets the same four names either way.
 */
function ConnectionalDiagram() {
  const courts = ["Congregation", "Presbytery", "Synod", "General Assembly"];

  return (
    <div className="mt-10">
      <svg
        viewBox="0 0 800 60"
        aria-hidden="true"
        className="mx-auto h-10 w-full max-w-2xl text-primary-foreground sm:h-12"
      >
        <line
          x1="50"
          y1="30"
          x2="750"
          y2="30"
          stroke="currentColor"
          strokeWidth="2"
          strokeOpacity="0.5"
        />
        {[50, 283, 517, 750].map((cx) => (
          <circle key={cx} cx={cx} cy="30" r="9" fill="currentColor" />
        ))}
      </svg>
      <div className="mx-auto mt-3 grid max-w-2xl grid-cols-2 gap-x-4 gap-y-2 text-center sm:grid-cols-4">
        {courts.map((label) => (
          <p
            key={label}
            className="text-sm font-medium text-primary-foreground/90"
          >
            {label}
          </p>
        ))}
      </div>
    </div>
  );
}

// Shared external-link treatment for the two off-app pointers in the
// "Open source" / "Get involved" sections below (GitHub repo, the
// architecture doc's GitHub blob view) — the platform focus-ring pattern
// (docs/ui-standards.md → "Focus rings, always with a 2px offset"), since
// there is no shadcn primitive for an inline text link.
const EXTERNAL_LINK_CLASSNAME =
  "rounded-sm font-medium text-primary underline underline-offset-4 outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default async function Home() {
  const session = await auth();
  const signedIn = !!session?.user;
  const greeting = session?.user?.name ?? session?.user?.email ?? "friend";

  return (
    <main>
      {/*
       * Top sign-in bar (second-revision addition, docs/work-log/
       * 2026-08-27-platform-home-and-portal.md "Commit 3 — second revision").
       * Slim, platform-toned strip above the hero: wordmark on the left, the
       * DECISION-034 auth action on the right. This is now the page's only
       * sign-in/Continue/Sign-out entry point — the hero used to repeat the
       * same buttons lower on the page, which read as two competing prompts
       * once this bar existed, so that row was removed rather than kept
       * redundantly (the "Welcome back" greeting stays where it was, since a
       * greeting is not a competing call-to-action).
       */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <Link
            href="/"
            aria-label="PresbyPortal"
            className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <PlatformWordmark heightPx={28} />
          </Link>
          <div className="flex items-center gap-3">
            {signedIn ? (
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <Button type="submit">Sign out</Button>
              </form>
            ) : (
              <Button asChild>
                <Link href="/signin">Sign in</Link>
              </Button>
            )}
            {signedIn ? (
              // /launch, not /home: it is the single post-authentication target and
              // it works out where this particular user belongs. A signed-in user
              // is entitled to read the front page, so this page never redirects
              // them (DECISION-034) — it offers the way in and nothing more.
              <Button asChild variant="outline">
                <Link href="/launch">Continue</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {/*
       * Hero — the one place on this page that spends visual boldness
       * (design brief: "Commit 3 correction"). Full-bleed `bg-primary` /
       * `text-primary-foreground`, platform tokens only — this route is not
       * a brandable group (CLAUDE.md → The Brand Is a Cascade Override), so
       * it always renders the platform palette, never a per-org brand.
       * The fade/slide-in is class-based (`tw-animate-css`'s `animate-in`
       * utilities), so globals.css's blanket
       * `@media (prefers-reduced-motion: reduce)` rule (which forces
       * animation-duration to ~0) neutralizes it automatically — no inline
       * style duration to fight that override.
       *
       * The oversized, low-opacity arch mark bleeding off the right edge
       * (docs/work-log/2026-08-27-presbyportal-brand-kit.md) is purely
       * decorative texture, not a second logo instance — `decorative` on
       * `PlatformMark` marks it `aria-hidden`/`alt=""` so it's invisible to
       * assistive tech, and `z-0`/`relative z-10` on the content wrapper
       * below keeps it strictly behind the headline regardless of DOM
       * order (an absolutely-positioned element paints above static
       * content unless the static content is itself given a stacking
       * context). `overflow-hidden` on the section is what lets it bleed
       * off the edge without widening the page.
       */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <PlatformMark
          variant="reverse"
          decorative
          className="pointer-events-none absolute -right-24 top-1/2 z-0 h-[140%] w-auto -translate-y-1/2 opacity-[0.07] sm:-right-12 sm:h-[170%]"
        />
        <div className="relative z-10 mx-auto max-w-3xl px-6 py-20 text-center sm:py-28">
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* `hero` type-scale role — documented exception, docs/ui-standards.md
                Type Scale table. Used ONLY here; every other heading on this
                page uses the existing seven roles correctly. The small
                uppercase "presby" kicker that used to sit above this
                headline is gone (second revision): DECISION-126 settled the
                project's name as PresbyPortal, so the top bar's wordmark now
                carries that identity and a second, smaller name-label here
                would only repeat it. */}
            <h1 className="text-5xl font-bold tracking-tight md:text-6xl">
              Church government is connectional. Your software should be too.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg text-primary-foreground/80">
              A congregation doesn&rsquo;t stand alone under Presbyterian
              polity — every session answers upward, through presbytery and
              synod, to the General Assembly. PresbyPortal is built around
              that shape: a membership roll that is the permanent record of
              who belongs, and courts that connect every level of the church
              to the ones above it.
            </p>
            <ConnectionalDiagram />
          </div>
        </div>
      </section>

      {/* Everything below the hero returns to the quiet, neutral palette. */}
      <div className="mx-auto max-w-3xl space-y-14 px-6 py-16 sm:py-20">
        <section className="space-y-6">
          <h2 className="text-xl font-semibold">What PresbyPortal does</h2>
          <div className="grid gap-8 sm:grid-cols-2">
            <div className="space-y-1">
              <h3 className="text-lg font-medium">Membership & records</h3>
              <p className="text-base text-muted-foreground">
                A membership roll kept the way the Book of Order requires it
                — professions of faith, transfers, deaths, and every other
                action that moves someone on or off it, recorded and never
                silently overwritten — alongside officer terms, ordinations,
                a searchable directory, and committees and groups.
              </p>
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-medium">Council operations</h3>
              <p className="text-base text-muted-foreground">
                Presbytery-level credentialing: ordinations, changes in
                standing, and pastoral appointments to member congregations —
                the software following the same upward structure the courts
                themselves follow.
              </p>
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-medium">Events & support</h3>
              <p className="text-base text-muted-foreground">
                Scheduling for single and recurring events, and a
                support-ticket loop that turns one congregation&rsquo;s
                &ldquo;we need this&rdquo; into a feature every church on the
                platform gets.
              </p>
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-medium">Public websites</h3>
              <p className="text-base text-muted-foreground">
                Each congregation, presbytery, or synod that adopts
                PresbyPortal can also publish its own public website from the
                same platform.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-xl font-semibold">Who it&rsquo;s for</h2>
          <div className="grid gap-8 sm:grid-cols-3">
            <div className="space-y-1">
              <h3 className="text-lg font-medium">Congregations</h3>
              <p className="text-base text-muted-foreground">
                Keeping their own roll, officers, and directory.
              </p>
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-medium">Presbyteries</h3>
              <p className="text-base text-muted-foreground">
                Recording ministerial credentials and council operations for
                their member congregations.
              </p>
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-medium">Synods</h3>
              <p className="text-base text-muted-foreground">
                Coordinating across presbyteries.
              </p>
            </div>
          </div>
          <p className="text-base text-muted-foreground">
            Each level keeps its own records, visible only to the people who
            hold access to that congregation, presbytery, or synod.
          </p>
        </section>

        {/*
         * Architecture teaser (second revision) — a pointer, not a copy of
         * docs/architecture.md. Three points chosen for how distinctive they
         * are, not for coverage: the isolation model, the roll as ledger
         * (not a status field), and the connectional data model, which ties
         * directly back to the hero's own diagram above.
         */}
        <section className="space-y-6">
          <h2 className="text-xl font-semibold">How it&rsquo;s built</h2>
          <div className="space-y-4">
            <p className="text-base text-muted-foreground">
              Every congregation&rsquo;s data is walled off from every other
              congregation&rsquo;s at the database level, not just filtered by
              application code — a tenant table can&rsquo;t be queried across
              organizations even by a bug, because the database itself
              refuses the read.
            </p>
            <p className="text-base text-muted-foreground">
              The membership roll isn&rsquo;t a status field. Every action
              against it — a profession of faith, a transfer, a death — is
              appended to a permanent record and never edited afterward; a
              correction is itself a new, recorded action, not a silent
              overwrite.
            </p>
            <p className="text-base text-muted-foreground">
              The same connectional shape drawn above governs the data too:
              authority flows up through the courts by publication, never
              down by inheritance. A presbytery sees what a congregation
              publishes to it and nothing else by default.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Read the full{" "}
            <a
              href="https://chenson42.github.io/presby/"
              target="_blank"
              rel="noreferrer"
              className={EXTERNAL_LINK_CLASSNAME}
            >
              architecture overview
            </a>
            , including how a human and a fleet of specialized AI agents
            actually build this codebase, phase by phase.
          </p>
        </section>

        {/*
         * Open source / sponsor attribution (second revision). This is real,
         * sanctioned attribution for a real, willing sponsoring congregation
         * — the one deliberate exception to the No Real Data invariant on
         * this page (CLAUDE.md → No Real Data guards fictional data
         * masquerading as real; this is the opposite, honest credit for a
         * real relationship). No other section on this page names a real
         * congregation.
         */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Open source</h2>
          <p className="text-base text-muted-foreground">
            PresbyPortal is open source, and its development is supported by
            the mission of First Presbyterian Church of Westerville.
          </p>
        </section>

        {/*
         * Get involved (second revision) — grounded in what's actually
         * there: the real public repository and its real license. No
         * invented contribution process; CONTRIBUTING.md doesn't exist yet,
         * and this says so rather than overselling an onboarding flow that
         * isn't built.
         */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Get involved</h2>
          <p className="text-base text-muted-foreground">
            The source is public on GitHub under the MIT license. Browse the
            code or open an issue at{" "}
            <a
              href="https://github.com/chenson42/presby"
              target="_blank"
              rel="noreferrer"
              className={EXTERNAL_LINK_CLASSNAME}
            >
              github.com/chenson42/presby
            </a>
            . Formal contribution guidelines aren&rsquo;t written yet.
          </p>
        </section>

        <p className="text-sm text-muted-foreground">
          Pre-release. Nothing here is a live congregation.
        </p>

        {signedIn && (
          <p className="text-sm text-muted-foreground">
            Welcome back,{" "}
            <span className="font-medium text-foreground">{greeting}</span>.
          </p>
        )}
      </div>
    </main>
  );
}
