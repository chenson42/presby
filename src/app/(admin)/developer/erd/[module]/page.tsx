import Link from "next/link";
import { notFound } from "next/navigation";
import {
  buildSchemaDocs,
  buildErd,
  loadDescriptions,
  moduleSlug,
  summarize,
} from "@/lib/dev-docs";
import { requirePlatformAdmin } from "../../guard";
import { Erd } from "../../erd";
import "../../developer.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  return { title: `${module} diagram` };
}

/**
 * One module's entity diagram, full width, rendered on arrival.
 *
 * Nothing to expand: the diagram IS the page, so getting to it is a link rather
 * than a disclosure that may or may not open.
 */
export default async function ErdPage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module: slug } = await params;
  await requirePlatformAdmin(`/developer/erd/${slug}`);

  const tables = buildSchemaDocs(await loadDescriptions());
  const moduleName = [...new Set(tables.map((t) => t.module))].find(
    (m) => moduleSlug(m) === slug,
  );
  if (!moduleName) notFound();

  const inModule = tables.filter((t) => t.module === moduleName);

  return (
    <div className="reg">
      <div className="reg__inner">
        <nav className="reg__crumbs">
          <Link href="/developer">Data model</Link>
          <span aria-hidden>/</span>
          <span>{moduleName}</span>
        </nav>

        <header className="reg__masthead">
          <p className="reg__eyebrow">entity diagram</p>
          <h1 className="reg__title">{moduleName}</h1>
          <p className="reg__standfirst">
            Generated from the foreign keys actually declared in the schema.
            Solid marks a required parent, hollow an optional one. Composite
            tenant keys all carry <code>organization_id</code>, so they are
            collapsed to one edge per table pair.
          </p>
        </header>

        <Erd chart={buildErd(tables, moduleName)} id={slug} />

        <section className="reg__module">
          <div className="reg__moduleHead">
            <h2 className="reg__moduleTitle">Tables in this module</h2>
            <span className="reg__moduleMeta">{inModule.length}</span>
          </div>
          <ul className="reg__list">
            {inModule.map((t) => (
              <li key={t.name}>
                <Link className="reg__row" href={`/developer/tables/${t.name}`}>
                  <span className="reg__rowName">{t.name}</span>
                  <span className="reg__rowSummary">
                    {summarize(t.description) || <em>No description</em>}
                  </span>
                  <span className="reg__rowMeta">{t.columns.length} col</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
