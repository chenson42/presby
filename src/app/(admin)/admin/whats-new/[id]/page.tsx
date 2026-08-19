import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { whatsNewEntries } from "@/lib/db/schema";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateWhatsNewEntry } from "../actions";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function WhatsNewEditPage({ params }: Props) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/admin/whats-new");
  if (!hasFeature(session.user.features, FEATURES.ADMIN_WHATS_NEW)) {
    redirect("/access-pending");
  }

  const entry = await db.query.whatsNewEntries.findFirst({
    where: eq(whatsNewEntries.id, id),
  });
  if (!entry) notFound();

  async function handleUpdate(formData: FormData) {
    "use server";
    const emoji = (formData.get("emoji") as string) ?? "";
    const title = (formData.get("title") as string) ?? "";
    const body = (formData.get("body") as string) ?? "";
    const result = await updateWhatsNewEntry(id, { emoji, title, body });
    if (result.ok) {
      redirect("/admin/whats-new");
    }
    // On validation error, redirect back (simple UX — full validation feedback
    // is on the create form; the edit page re-renders on next load).
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link
          href="/admin/whats-new"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to What&apos;s new
        </Link>
      </div>

      <h1 className="text-2xl font-semibold">Edit entry</h1>

      {/* publishedAt shown read-only to communicate editing does not move the entry */}
      <p className="mt-1 text-sm text-muted-foreground">
        Originally published{" "}
        <FormattedDate value={entry.publishedAt} mode="datetime" /> — editing
        does not change the publication date or order.
      </p>

      <form action={handleUpdate} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="emoji">
            Emoji <span className="text-muted-foreground">(optional, max 2)</span>
          </Label>
          <Input
            id="emoji"
            name="emoji"
            type="text"
            maxLength={10}
            defaultValue={entry.emoji ?? ""}
            className="mt-1 w-20"
          />
        </div>
        <div>
          <Label htmlFor="title">
            Title <span className="text-muted-foreground">(required, max 100 chars)</span>
          </Label>
          <Input
            id="title"
            name="title"
            type="text"
            required
            maxLength={100}
            defaultValue={entry.title}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="body">
            Body <span className="text-muted-foreground">(required, max 500 chars, plain text)</span>
          </Label>
          <Textarea
            id="body"
            name="body"
            required
            maxLength={500}
            rows={4}
            defaultValue={entry.body}
            className="mt-1"
          />
        </div>
        <div className="flex gap-3">
          <Button type="submit">Save changes</Button>
          <Button asChild variant="outline">
            <Link href="/admin/whats-new">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
