"use client";

// Minimal AlertDialog built on @radix-ui/react-dialog.
// Follows the no-native-dialogs invariant: use this instead of window.confirm().

import * as Dialog from "@radix-ui/react-dialog";
import * as React from "react";

export const AlertDialog = Dialog.Root;
export const AlertDialogTrigger = Dialog.Trigger;

export function AlertDialogContent({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Content>) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content
        {...props}
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-lg focus:outline-none"
      >
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function AlertDialogHeader({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="space-y-2">{children}</div>;
}

export function AlertDialogFooter({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      {children}
    </div>
  );
}

export const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof Dialog.Title>,
  React.ComponentPropsWithoutRef<typeof Dialog.Title>
>(({ className, ...props }, ref) => (
  <Dialog.Title
    ref={ref}
    className={`text-lg font-semibold ${className ?? ""}`}
    {...props}
  />
));
AlertDialogTitle.displayName = "AlertDialogTitle";

export const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof Dialog.Description>,
  React.ComponentPropsWithoutRef<typeof Dialog.Description>
>(({ className, ...props }, ref) => (
  <Dialog.Description
    ref={ref}
    className={`text-sm text-muted-foreground ${className ?? ""}`}
    {...props}
  />
));
AlertDialogDescription.displayName = "AlertDialogDescription";

export const AlertDialogAction = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    className={`inline-flex h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none disabled:pointer-events-none disabled:opacity-50 ${className ?? "bg-foreground text-background hover:opacity-90"}`}
    {...props}
  />
));
AlertDialogAction.displayName = "AlertDialogAction";

export const AlertDialogCancel = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <Dialog.Close asChild>
    <button
      ref={ref}
      className={`inline-flex h-10 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted focus:outline-none disabled:pointer-events-none disabled:opacity-50 ${className ?? ""}`}
      {...props}
    />
  </Dialog.Close>
));
AlertDialogCancel.displayName = "AlertDialogCancel";
