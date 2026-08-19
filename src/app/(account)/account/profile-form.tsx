"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfile } from "./actions";

export function ProfileForm({ name }: { name: string | null }) {
  const [value, setValue] = useState(name ?? "");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) {
      toast.error("Name cannot be blank.");
      return;
    }
    setPending(true);
    const result = await updateProfile({ name: value });
    setPending(false);
    if (result.ok) {
      toast.success("Name updated.");
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <div>
        <Label htmlFor="display-name">Display name</Label>
        <Input
          id="display-name"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={100}
          required
          className="mt-1"
          placeholder="Your name"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}
