"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { replyToTicketAction } from "../actions";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Reply to an already-filed ticket, with an optional attachment. */
export function ReplyForm({
  slug,
  ticketId,
}: {
  slug: string;
  ticketId: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isSubmitDisabled = pending || body.trim().length === 0;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setAttachmentError(null);
    if (selected && selected.size > MAX_ATTACHMENT_BYTES) {
      setAttachmentError("That file is larger than 10MB.");
      setFile(null);
      e.target.value = "";
      return;
    }
    setFile(selected);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitDisabled) return;
    setPending(true);

    const formData = new FormData();
    formData.set("body", body);
    if (file) formData.set("attachment", file);

    const result = await replyToTicketAction(slug, ticketId, formData);
    setPending(false);

    if (result.ok) {
      toast.success("Reply sent.");
      setBody("");
      setFile(null);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 border-t border-border pt-6"
    >
      <div>
        <Label htmlFor="ticket-reply-body">Reply</Label>
        <Textarea
          id="ticket-reply-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={5000}
          disabled={pending}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="ticket-reply-attachment">
          Attachment{" "}
          <span className="font-normal text-muted-foreground">
            (optional — PNG, JPEG, WEBP, or PDF, up to 10MB)
          </span>
        </Label>
        <Input
          id="ticket-reply-attachment"
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          onChange={handleFileChange}
          disabled={pending}
          className="mt-1"
        />
        {attachmentError && (
          <p className="mt-1 text-sm text-destructive">{attachmentError}</p>
        )}
      </div>
      <Button type="submit" disabled={isSubmitDisabled} className="min-h-11">
        {pending ? "Sending…" : "Send reply"}
      </Button>
    </form>
  );
}
