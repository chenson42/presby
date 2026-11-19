import { carriesNote, carriesWarning } from "@/lib/committees/copy";

/**
 * The note (committee page) or warning (add form) shown only when the committee
 * carries a role: adding someone is then an access change, and it is said in
 * words. Renders nothing when no role is carried.
 */
export function CarriesRoleNote({ roleNames, variant }: { roleNames: readonly string[]; variant: "note" | "warning" }) {
  const text = variant === "note" ? carriesNote(roleNames) : carriesWarning(roleNames);
  if (text === null) return null;
  return (
    <p
      role={variant === "warning" ? "note" : undefined}
      data-testid="carries-role-note"
      className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
    >
      {text}
    </p>
  );
}
