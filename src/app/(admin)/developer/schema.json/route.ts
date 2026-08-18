import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  buildSchemaDocs,
  buildPermissionDocs,
  loadDescriptions,
  INVARIANTS,
} from "@/lib/dev-docs";

/**
 * Machine-readable twin of /developer.
 *
 * This is the AI support worker's map of the system. Generated from the same
 * source as the HTML page, so the two cannot disagree — which is the point.
 * A worker that navigates the schema from a hand-written document will act on
 * a stale one eventually.
 *
 * Structure only, never data. Same gate as the page.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [me] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!me?.isPlatformAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Same source as the HTML page, descriptions included, so the two cannot
  // disagree about what the schema is.
  const tables = buildSchemaDocs(await loadDescriptions());

  return NextResponse.json(
    {
      generatedFrom: "src/lib/db/schema",
      designDoc: "docs/schema-design.md",
      counts: {
        tables: tables.length,
        tenantScoped: tables.filter((t) => t.tenantScoped).length,
      },
      invariants: INVARIANTS,
      permissions: buildPermissionDocs(),
      tables,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
