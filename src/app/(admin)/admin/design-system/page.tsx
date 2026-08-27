"use client";

// A static review page for P0.5 slice a — every primitive and token in one
// screen so the operator can sign off without clicking through a dozen admin
// pages. 'use client' for the whole file rather than three small wrapper
// components: this page fetches no data and every section but the last is a
// component demo, so the split would add files without adding safety.
//
// No dark-mode toggle lives here on purpose (P0.5 a3, E14 — slice a ships
// the .dark mechanism only, no toggle UI). Use your OS or browser's
// prefers-color-scheme setting to see both schemes.

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TYPE_PAIRINGS } from "@/lib/brand/contract";
import { resolveTypePairing } from "@/lib/brand/fonts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const BUTTON_VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;

const BUTTON_SIZES = ["default", "sm", "lg"] as const;

const BADGE_VARIANTS = [
  "default",
  "secondary",
  "destructive",
  "outline",
  "ghost",
  "link",
] as const;

const TYPE_SCALE = [
  { role: "display", cls: "text-3xl", tw: "text-3xl", where: "page-level hero" },
  { role: "title", cls: "text-2xl font-semibold", tw: "text-2xl", where: "the single <h1>" },
  { role: "section", cls: "text-xl font-semibold", tw: "text-xl", where: "<h2>" },
  { role: "subhead", cls: "text-lg font-semibold", tw: "text-lg", where: "<h3>" },
  { role: "body", cls: "text-base", tw: "text-base", where: "all body copy — the floor" },
  { role: "dense", cls: "text-sm", tw: "text-sm", where: "table cells, metadata, labels" },
  { role: "micro", cls: "text-xs", tw: "text-xs", where: "(admin) and /developer only" },
] as const;

// Grouped by TOKEN_POLICY (src/lib/brand/contract.ts). Every entry pairs a
// background token with the foreground token that renders text on it, so
// each swatch also proves the pairing that LEGAL_PAIRS checks.
const TOKEN_SWATCHES: {
  group: "brandable" | "bounded" | "platform";
  bg: string;
  fg: string;
  label: string;
}[] = [
  { group: "brandable", bg: "bg-primary", fg: "text-primary-foreground", label: "primary" },
  { group: "bounded", bg: "bg-background", fg: "text-foreground", label: "background" },
  { group: "bounded", bg: "bg-accent", fg: "text-accent-foreground", label: "accent" },
  { group: "platform", bg: "bg-card", fg: "text-card-foreground", label: "card" },
  { group: "platform", bg: "bg-popover", fg: "text-popover-foreground", label: "popover" },
  { group: "platform", bg: "bg-muted", fg: "text-muted-foreground", label: "muted" },
  { group: "platform", bg: "bg-secondary", fg: "text-secondary-foreground", label: "secondary" },
  { group: "platform", bg: "bg-destructive", fg: "text-white", label: "destructive" },
];

const GROUP_LABEL: Record<string, string> = {
  brandable: "Brandable — a per-org brand may re-declare this",
  bounded: "Bounded — re-declarable only within a named constraint",
  platform: "Platform — never re-declarable, by any organization",
};

export default function DesignSystemPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="max-w-4xl space-y-12">
      <div>
        <h1 className="text-2xl font-semibold">Design system</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every primitive and token from P0.5 (docs/work-log/2026-08-19-brand-foundation.md)
          in one screen, for sign-off. Tab through the page to see the focus
          ring&apos;s offset; toggle your OS/browser colour scheme to see dark
          mode — no in-app toggle ships yet (E14).
        </p>
      </div>

      {/* Tokens ------------------------------------------------------- */}
      <section>
        <h2 className="text-xl font-semibold">Colour and tokens</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Source of truth: <code>src/lib/brand/contract.ts</code>. Each swatch
          renders a background/foreground pair exactly as{" "}
          <code>LEGAL_PAIRS</code> checks it.
        </p>
        {(["brandable", "bounded", "platform"] as const).map((group) => (
          <div key={group} className="mt-4">
            <p className="text-xs font-medium text-muted-foreground">
              {GROUP_LABEL[group]}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {TOKEN_SWATCHES.filter((t) => t.group === group).map((t) => (
                <div
                  key={t.label}
                  className={`flex h-20 flex-col justify-between rounded-md border border-border p-3 ${t.bg} ${t.fg}`}
                >
                  <span className="font-mono text-xs">{t.label}</span>
                  <span className="text-sm">Aa</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Type scale ----------------------------------------------------- */}
      <section>
        <h2 className="text-xl font-semibold">Type scale</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Seven roles, all <code>rem</code>. 16px is the body floor;{" "}
          <code>micro</code> is restricted to <code>(admin)</code> and{" "}
          <code>/developer</code>.
        </p>
        <div className="mt-4 space-y-3">
          {TYPE_SCALE.map((t) => (
            <div key={t.role} className="flex items-baseline gap-4">
              <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
                {t.role}
              </span>
              <span className={t.cls}>The quick brown fox — {t.where}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Type pairings ----------------------------------------------------- */}
      <section>
        <h2 className="text-xl font-semibold">Type pairings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Source of truth: <code>TYPE_PAIRINGS</code> in{" "}
          <code>src/lib/brand/contract.ts</code>, resolved to real self-hosted
          faces by <code>src/lib/brand/fonts.ts</code>. This is the only
          place these fonts render today — the church-facing editor and the{" "}
          <code>(org)</code> emitter are later slices — so this section is
          the A10/e1 360px-and-both-schemes validation surface, kept
          permanently rather than thrown away, since a curated set that isn&apos;t
          re-checked on every future change is a colour picker with fewer
          options.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {TYPE_PAIRINGS.map((pairing) => {
            const resolved = resolveTypePairing(pairing.key);
            return (
              <div
                key={pairing.key}
                className="rounded-md border border-border p-4"
              >
                <p className="font-mono text-xs text-muted-foreground">
                  {pairing.key}
                </p>
                <h3
                  className={`${resolved.headingClassName} mt-2 text-xl font-semibold`}
                >
                  {pairing.label} pairing
                </h3>
                <p className={`${resolved.bodyClassName} mt-1 text-sm`}>
                  The quick brown fox jumps over the lazy dog — {pairing.heading} /{" "}
                  {pairing.body}.
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Buttons ---------------------------------------------------------- */}
      <section>
        <h2 className="text-xl font-semibold">Buttons</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every variant at default size, then the size scale on the default
          variant. Every hand-rolled button in the app now renders through
          this component (P0.5 a5–a7).
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {BUTTON_VARIANTS.map((v) => (
            <Button key={v} variant={v}>
              {v}
            </Button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {BUTTON_SIZES.map((s) => (
            <Button key={s} size={s}>
              size {s}
            </Button>
          ))}
          <Button size="icon" aria-label="icon example">
            ★
          </Button>
          <Button disabled>disabled</Button>
        </div>
      </section>

      {/* Badges ------------------------------------------------------------ */}
      <section>
        <h2 className="text-xl font-semibold">Badges</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Status chips across the sweep migrate shape onto{" "}
          <code>{"<Badge variant=\"outline\">"}</code>, retaining any
          pre-existing status colour (semantic status tokens are a later
          slice — docs/TODO.md).
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {BADGE_VARIANTS.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
          <Badge
            variant="outline"
            className="bg-green-500/15 text-green-700 dark:text-green-300"
          >
            retained colour example
          </Badge>
        </div>
      </section>

      {/* Form fields --------------------------------------------------- */}
      <section>
        <h2 className="text-xl font-semibold">Form fields</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <code>Label</code>, <code>Input</code>, <code>Textarea</code> — the
          control border (<code>border-input</code>) carries the 3:1 floor;
          the ring shows the D4 offset on focus.
        </p>
        <div className="mt-4 max-w-sm space-y-4">
          <div>
            <Label htmlFor="ds-input">Congregation name</Label>
            <Input id="ds-input" placeholder="Wrenfield Presbyterian Church" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="ds-textarea">Notes</Label>
            <Textarea id="ds-textarea" placeholder="Anything the clerk should know." className="mt-1" />
          </div>
          <div>
            <Label htmlFor="ds-disabled">Disabled field</Label>
            <Input id="ds-disabled" disabled defaultValue="Read-only" className="mt-1" />
          </div>
        </div>
      </section>

      {/* Table ----------------------------------------------------------- */}
      <section>
        <h2 className="text-xl font-semibold">Table</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Wraps in an internal <code>overflow-x-auto</code> — the table
          scrolls, never the page (E5). Try this at 360px.
        </p>
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>example.clerk@presby.invalid</TableCell>
              <TableCell>Clerk of Session</TableCell>
              <TableCell>
                <Badge variant="outline" className="bg-green-500/15 text-green-700 dark:text-green-300">
                  active
                </Badge>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>example.admin@presby.invalid</TableCell>
              <TableCell>Congregation Admin</TableCell>
              <TableCell>
                <Badge variant="secondary">inactive</Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* Dropdown menu ----------------------------------------------------- */}
      <section>
        <h2 className="text-xl font-semibold">Dropdown menu</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The same primitive behind the avatar menu and organization switcher
          (untouched by the sweep — see the a7 handoff notes).
        </p>
        <div className="mt-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Open menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>View details</DropdownMenuItem>
              <DropdownMenuItem>Edit</DropdownMenuItem>
              <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      {/* Alert dialog -------------------------------------------------- */}
      <section>
        <h2 className="text-xl font-semibold">Alert dialog</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Real <code>role=&quot;alertdialog&quot;</code> semantics (P0.5 a4):
          focus trapped, outside click does not close, Escape does.
        </p>
        <div className="mt-4">
          <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete something</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This is a demo dialog — nothing is actually deleted. Escape
                  closes it; clicking outside does not.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => setDialogOpen(false)}>
                  Confirm
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>

      {/* Toast ----------------------------------------------------------- */}
      <section>
        <h2 className="text-xl font-semibold">Toast</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Follows the resolved colour scheme via <code>next-themes</code>{" "}
          (P0.5 a3) — no flash on toggle.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => toast.success("Saved.")}>
            Success toast
          </Button>
          <Button variant="outline" onClick={() => toast.error("Something went wrong.")}>
            Error toast
          </Button>
          <Button variant="outline" onClick={() => toast("Just so you know.")}>
            Neutral toast
          </Button>
        </div>
      </section>

      {/* Card ------------------------------------------------------------- */}
      <section>
        <h2 className="text-xl font-semibold">Card</h2>
        <Card className="mt-4 max-w-sm">
          <CardHeader>
            <CardTitle>Wrenfield Presbyterian Church</CardTitle>
            <CardDescription>Congregation · Fable Presbytery</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Example card content — the shape used for org cards on{" "}
            <code>/home</code>.
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
