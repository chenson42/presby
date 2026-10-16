import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The overview's "Online giving" card while Stripe is not wired up -
 * docs/work-log/2026-10-15-online-giving.md, Batch 2 ("a 'Connect Stripe'
 * placeholder card that says Stripe isn't set up yet - the real panel arrives
 * in B3"). A server component with no data and no controls: it makes the
 * absence honest instead of leaving a treasurer to wonder where online giving
 * went. Batch 3 replaces it with the connection card and connect panel.
 */
export function ConnectionPlaceholderCard() {
  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-medium">Stripe account</h3>
          <Badge variant="secondary">Not set up</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Connecting a Stripe account, so members and visitors can give by card or
          bank transfer, isn&apos;t set up yet. Everything else here works without
          it: you can already record gifts that arrive by cash, check or stock,
          keep your funds and donors, and set up the details for year-end
          statements.
        </p>
      </CardContent>
    </Card>
  );
}
