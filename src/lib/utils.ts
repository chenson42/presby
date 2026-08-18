import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names, with later classes winning conflicts.
 *
 * Deliberately NOT `server-only`: every shadcn primitive imports it, and those
 * render in both server and client components.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
