import { db } from "@/lib/db";
import { featureFlags } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toggleFlagAction } from "./actions";

export default async function FlagsPage() {
  const flags = await db
    .select()
    .from(featureFlags)
    .orderBy(asc(featureFlags.key));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Feature flags</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Environment-wide toggles. Distinct from role permissions: these gate
        whether a capability is even visible in this deployment, not who can
        use it.
      </p>
      <Table className="mt-6">
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Status</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {flags.map((f) => (
            <TableRow key={f.key}>
              <TableCell className="font-mono text-xs">{f.key}</TableCell>
              <TableCell className="text-xs">{f.description ?? "—"}</TableCell>
              <TableCell>
                {f.enabled ? (
                  <Badge
                    variant="outline"
                    className="bg-green-500/15 text-green-700 dark:text-green-300"
                  >
                    on
                  </Badge>
                ) : (
                  <Badge variant="secondary">off</Badge>
                )}
              </TableCell>
              <TableCell>
                <form action={toggleFlagAction}>
                  <input type="hidden" name="key" value={f.key} />
                  <Button type="submit" variant="outline" size="sm">
                    Toggle
                  </Button>
                </form>
              </TableCell>
            </TableRow>
          ))}
          {flags.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-6 text-center text-sm text-muted-foreground"
              >
                No flags yet. Add some in <code>scripts/seed.ts</code> or via SQL.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
