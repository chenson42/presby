import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { PROVENANCE, type ProvenanceKey } from "@/lib/developer-portal/provenance";
import { requireDeveloper } from "./guard";
import { GateState } from "./gate-state";
import { ProvenanceLabel } from "./provenance-label";

export const metadata = { title: { absolute: "Developer portal" } };

const SECTIONS: ReadonlyArray<{
  href: string;
  title: string;
  provenance: ProvenanceKey;
  description: string;
}> = [
  {
    href: "/developer/data-model",
    title: "Data model",
    provenance: "generated",
    description:
      "Every table, its columns and its links, with a diagram for each module. Built from the schema in the code and the database's own comments.",
  },
  {
    href: "/developer/docs",
    title: "Documentation",
    provenance: "planned",
    description:
      "What documentation exists, where it lives today, and what is planned.",
  },
];

/**
 * /developer: the portal's start page. It makes no database call (E20), so its
 * only failure state is the gate's.
 */
export default async function DeveloperHome() {
  const gate = await requireDeveloper("/developer");
  if (gate !== "ok") return <GateState gate={gate} retryHref="/developer" />;

  const inUse = [...new Set(SECTIONS.map((s) => s.provenance))];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">Developer portal</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        Engineering reference for PresbyPortal. It describes how the platform is
        built and does not read congregation records.
      </p>

      <section className="mt-8" aria-labelledby="developer-sections">
        <h2 id="developer-sections" className="text-lg font-semibold">
          Sections
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="group block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Card className="h-full gap-3 py-5 transition-colors group-hover:border-ring group-hover:bg-accent group-active:bg-accent/70">
                  <CardHeader className="gap-2">
                    <h3 className="text-base font-semibold leading-snug text-foreground">
                      {s.title}
                    </h3>
                    <ProvenanceLabel kind={s.provenance} />
                    <p className="text-sm text-muted-foreground">
                      {s.description}
                    </p>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10" aria-labelledby="developer-legend">
        <h2 id="developer-legend" className="text-lg font-semibold">
          What the labels mean
        </h2>
        <dl className="mt-4 space-y-3">
          {inUse.map((key) => (
            <div
              key={key}
              className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4"
            >
              <dt className="sm:w-40 sm:shrink-0">
                <ProvenanceLabel kind={key} />
              </dt>
              <dd className="text-sm text-muted-foreground">
                {PROVENANCE[key].meaning}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
