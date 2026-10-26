/**
 * Provenance labels (DECISION-258): every section of the portal says where its
 * content comes from, in text and an icon, never by colour alone.
 *
 * The icon is a Lucide NAME, not a component: this module is pure data, and a
 * component object crossing a server/client boundary is a live 500 elsewhere in
 * the project. `ProvenanceLabel` maps the name to the component.
 *
 * `tested` is not used by Increment 1. Its claim ("a test fails when it falls
 * out of step") must be true of the API registry before Increment 3 shows it.
 */
export type ProvenanceKey = "generated" | "tested" | "hand" | "planned";

export interface Provenance {
  label: string;
  meaning: string;
  icon: "Cog" | "ListChecks" | "PenLine" | "Hourglass";
}

export const PROVENANCE: Record<ProvenanceKey, Provenance> = {
  generated: {
    label: "Generated",
    meaning: "Computed from the code and the database when you open the page.",
    icon: "Cog",
  },
  tested: {
    label: "Tested list",
    meaning:
      "Written by hand, and a test fails when it falls out of step with the code.",
    icon: "ListChecks",
  },
  hand: {
    label: "Written by hand",
    meaning: "Written by a person; nothing checks the wording automatically.",
    icon: "PenLine",
  },
  planned: {
    label: "Planned",
    meaning: "Not built yet.",
    icon: "Hourglass",
  },
};
