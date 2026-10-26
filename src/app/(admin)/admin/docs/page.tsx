import { promises as fs } from "node:fs";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { auth } from "@/auth";
import { AdminForbidden } from "@/components/admin-portal/admin-forbidden";
import { FEATURES, hasFeature } from "@/lib/permissions";

/**
 * Note for forkers: every `.md` file under `docs/release-notes/` is readable
 * by anyone who holds the `admin.release_notes` feature. Don't drop
 * unredacted postmortems, customer lists, or anything else sensitive in this
 * directory — use a separate route with stricter gating if you need that.
 */
async function listReleaseFiles(): Promise<string[]> {
  const dir = path.join(process.cwd(), "docs", "release-notes");
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((f) => f.endsWith(".md"))
      // Numeric-aware sort so v0.10 ranks above v0.9 (plain string sort puts v0.10 between v0.0 and v0.2).
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

async function readReleaseFile(filename: string): Promise<string> {
  // `filename` is verified against the listed-files allowlist in the page
  // body before this is called, so path-traversal payloads can't escape.
  const full = path.join(process.cwd(), "docs", "release-notes", filename);
  return fs.readFile(full, "utf8");
}

export default async function DocsPage({
  searchParams,
}: {
  searchParams: Promise<{ file?: string }>;
}) {
  // Page-level gate (F281). The proxy also requires this key for the path, but
  // every console page checks its own, and this one did not. Nothing is read
  // from disk until the viewer is known to hold it.
  const session = await auth();
  if (!hasFeature(session?.user?.features, FEATURES.ADMIN_RELEASE_NOTES)) {
    return <AdminForbidden title="Release notes" area="release notes" />;
  }

  const sp = await searchParams;
  const files = await listReleaseFiles();
  const current = sp.file && files.includes(sp.file) ? sp.file : files[0];
  const body = current ? await readReleaseFile(current) : "";

  return (
    <div className="grid grid-cols-[200px_1fr] gap-8">
      <aside>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Versions
        </h2>
        <ul className="mt-3 space-y-1">
          {files.map((f) => (
            <li key={f}>
              <a
                href={`?file=${encodeURIComponent(f)}`}
                className={
                  f === current
                    ? "text-sm font-medium"
                    : "text-sm text-muted-foreground hover:text-foreground"
                }
              >
                {f.replace(/\.md$/, "")}
              </a>
            </li>
          ))}
        </ul>
      </aside>
      <article className="prose prose-sm max-w-none dark:prose-invert">
        {body ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {body}
          </ReactMarkdown>
        ) : (
          <p className="text-sm text-muted-foreground">
            No release notes yet. Run <code>/release-notes</code> via Claude
            Code to generate the first entry.
          </p>
        )}
      </article>
    </div>
  );
}
