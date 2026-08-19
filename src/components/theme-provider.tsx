"use client";

/**
 * A thin `'use client'` wrapper around next-themes' provider — nothing else
 * lives in this file (P0.5 slice a; DECISION-050).
 *
 * next-themes' pre-paint script is what applies the `.dark` class to `<html>`
 * before first render, which is the mechanism `src/app/globals.css`'s
 * `@custom-variant dark (&:is(.dark *))` reads. `defaultTheme="system"` means
 * an unconfigured visitor gets their OS preference; `next-themes` persists an
 * explicit choice to `localStorage`, which is DEVICE-level, not account-level.
 * S17 asked for account-level persistence — that is a `users` column plus a
 * server-rendered initial class and belongs to the account-surface work, not
 * this slice. Slice a ships the mechanism only; no toggle UI (E14).
 */
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
