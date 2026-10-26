/**
 * The developer portal's navigation registry (DECISION-258, DECISION-261).
 *
 * PURE SYNCHRONOUS DATA, like `ADMIN_NAV_GROUPS`: no session, no query, no
 * permission check. It is UNFILTERED because every entitled viewer sees every
 * item; the layout decides whether to show the nav at all from its own live
 * read, and each destination re-gates itself. Hiding is not authorization.
 *
 * The portal never appears in the admin left nav (DECISION-044); the way back
 * to /admin is the avatar menu, gated on the session's `canAccessAdmin`.
 *
 * Data model lights on `/developer/tables/*` and `/developer/erd/*` as well,
 * because those pages live outside `/developer/data-model` (they keep their
 * original URLs). Increment 3 adds API, Rules and Access under Reference.
 */
export interface DeveloperNavItem {
  label: string;
  href: string;
  /** Active only on an exact pathname match (Home). */
  exact?: boolean;
  /** Extra path prefixes (segment boundary) that also light this item. */
  alsoActiveOn?: readonly string[];
}

export interface DeveloperNavGroup {
  key: string;
  /** `null` = no visible heading (Home stands alone). */
  heading: string | null;
  items: readonly DeveloperNavItem[];
}

export const DEVELOPER_NAV_GROUPS: readonly DeveloperNavGroup[] = [
  {
    key: "home",
    heading: null,
    items: [{ label: "Home", href: "/developer", exact: true }],
  },
  {
    key: "reference",
    heading: "Reference",
    items: [
      {
        label: "Data model",
        href: "/developer/data-model",
        alsoActiveOn: ["/developer/tables", "/developer/erd"],
      },
    ],
  },
  {
    key: "guides",
    heading: "Guides",
    items: [{ label: "Documentation", href: "/developer/docs" }],
  },
];
