import Link from "next/link";
import { auth } from "@/auth";
import { isFlagEnabled } from "@/lib/flags";

export default async function AdminDashboard() {
  const session = await auth();

  // EXAMPLE: feature-flag gate. See CLAUDE.md → Permissions vs Flags.
  // `isFlagEnabled` hits the feature_flags table and checks the `enabled`
  // column. Flip "demo.new_dashboard" in /admin/flags to show or hide this
  // banner without a redeploy. For per-user access control use hasFeature()
  // instead.
  const showDashboardPreview = await isFlagEnabled("demo.new_dashboard");
  const cards = [
    {
      href: "/admin/design-system",
      title: "Design system",
      blurb: "Every primitive and token in one screen — the P0.5 sign-off page.",
    },
    {
      href: "/admin/organizations",
      title: "Organizations",
      blurb:
        "Set a congregation's brand colour, logo and type pairing, and see which are still on the default palette.",
    },
    {
      href: "/admin/users",
      title: "Users & roles",
      blurb: "Assign roles to users.",
    },
    {
      href: "/admin/flags",
      title: "Feature flags",
      blurb: "Toggle environment features.",
    },
    {
      href: "/admin/docs",
      title: "Release notes",
      blurb: "What shipped, when.",
    },
    {
      href: "/admin/feedback",
      title: "Feedback",
      blurb: "Review member suggestions and bug reports.",
    },
    {
      href: "/admin/audit",
      title: "Audit log",
      blurb: "Security events, sign-ins, and flag changes.",
    },
    {
      href: "/admin/email-queue",
      title: "Email queue",
      blurb: "Monitor outbound email and retry failed sends.",
    },
    {
      href: "/admin/whats-new",
      title: "What's new",
      blurb: "Publish updates for members to see on their home page.",
    },
    {
      href: "/admin/2fa",
      title: "2FA policy",
      blurb:
        "Choose which congregations require two-factor, and see who is required but not enrolled.",
    },
  ];

  return (
    <div>
      {showDashboardPreview && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          <span className="font-medium">New dashboard preview is enabled.</span>{" "}
          Toggle the <code>demo.new_dashboard</code> flag in{" "}
          <Link href="/admin/flags" className="underline">
            Feature flags
          </Link>{" "}
          to hide this banner.
        </div>
      )}
      <h1 className="text-2xl font-semibold">Welcome, {session?.user?.name ?? "admin"}.</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Roles: {session?.user?.roles?.join(", ") || "—"}
      </p>
      <div className="mt-8 grid grid-cols-2 gap-4">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-lg border border-border p-5 hover:bg-muted"
          >
            <div className="font-medium">{c.title}</div>
            <div className="mt-1 text-sm text-muted-foreground">{c.blurb}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
