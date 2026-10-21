"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, "type" | "disabled"> & {
  /** Label while the surrounding form's action is pending. */
  pendingLabel: string;
};

/**
 * A submit button that disables itself and swaps its label while the nearest
 * ancestor `<form action={serverAction}>` is pending. Its own component because
 * `useFormStatus()` reads the nearest ANCESTOR form, so the component that
 * renders the form cannot call it. For a plain server-action form with no
 * client state (Component Convention 5).
 */
export function SubmitButton({ pendingLabel, children, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending || undefined} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
