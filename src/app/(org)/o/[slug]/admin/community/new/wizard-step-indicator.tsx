/**
 * "Step X of N" — req 6, always visible, never a hardcoded "5": the wizard's
 * step sequence is adaptive (Confirm only renders when a duplicate-match
 * candidate exists, Identity only when `identityMode === "new"`), so this
 * component takes the CALLER's already-computed step list rather than
 * assuming a fixed count.
 */
export function WizardStepIndicator({
  currentIndex,
  totalSteps,
  label,
}: {
  /** 0-based. */
  currentIndex: number;
  totalSteps: number;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">
        Step {currentIndex + 1} of {totalSteps}: {label}
      </p>
      <div className="flex gap-1" role="presentation">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={
              "h-1.5 flex-1 rounded-full " +
              (i <= currentIndex ? "bg-primary" : "bg-muted")
            }
          />
        ))}
      </div>
    </div>
  );
}
