"use client";

import { useState } from "react";
import { toast } from "sonner";
import { changePassword } from "./actions";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    if (next.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setPending(true);
    const result = await changePassword({
      currentPassword: current,
      newPassword: next,
      confirmPassword: confirm,
    });
    setPending(false);
    if (result.ok) {
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Password updated.");
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <div>
        <label htmlFor="current-password" className="block text-sm font-medium">
          Current password
        </label>
        <input
          id="current-password"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="new-password" className="block text-sm font-medium">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="confirm-password" className="block text-sm font-medium">
          Confirm new password
        </label>
        <input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {pending ? "Updating…" : "Change password"}
      </button>
    </form>
  );
}
