/**
 * L3 (docs/reviews/2026-08-26-portal-ux.md) — the one visual marker for a
 * required field, used beside the label text. Pairs with `aria-required` on
 * the field itself (never relies on the asterisk alone — it's `aria-hidden`
 * so a screen reader isn't read a bare "star").
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-destructive">
      {" "}
      *
    </span>
  );
}
