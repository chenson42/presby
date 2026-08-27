"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ChangeClass, TicketArea, TicketPriority } from "@/lib/tickets";
import {
  CHANGE_CLASSES,
  TICKET_AREAS,
  TICKET_PRIORITIES,
  CHANGE_CLASS_LABELS,
  TICKET_AREA_LABELS,
  TICKET_PRIORITY_LABELS,
} from "@/lib/tickets-labels";
import { fileTicketAction, promoteFeedbackAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// Client-side hint only — mirrors the server's own accepted set
// (src/lib/storage/blob-store.ts's ALLOWED_CONTENT_TYPES / MAX_BYTE_SIZE,
// DECISION-071/073). The server always re-sniffs the actual bytes via
// sniffTicketAttachmentContentType() and is the authoritative gate.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ACCEPTED_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
];

export interface FromFeedback {
  feedbackId: string;
  submitterDisplayName: string;
  body: string;
}

/**
 * Files a ticket directly, OR — when `fromFeedback` is supplied — promotes a
 * piece of congregation feedback into one. ONE component, TWO submit
 * targets (Phase 3's own framing): `fileTicketAction` (FormData, carries an
 * optional attachment) vs `promoteFeedbackAction` (a plain object — the
 * ticket's opening message comes from the feedback row itself, per
 * `promoteFeedbackToTicket()`'s own contract, so there is no body field or
 * attachment field to submit in promote mode at all).
 *
 * Priority defaults to "Normal", pre-selected — matches the DB default and
 * the DECISION-076 reasoning that a submitter shouldn't have to think about
 * priority on the common case.
 */
export function FileTicketForm({
  slug,
  fromFeedback,
}: {
  slug: string;
  fromFeedback?: FromFeedback;
}) {
  const router = useRouter();
  const isPromote = fromFeedback != null;

  const [subject, setSubject] = useState("");
  const [changeClass, setChangeClass] = useState<ChangeClass>("bug");
  const [area, setArea] = useState<TicketArea>("other");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isSubmitDisabled =
    pending ||
    subject.trim().length === 0 ||
    (!isPromote && body.trim().length === 0);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setAttachmentError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (selected.size > MAX_ATTACHMENT_BYTES) {
      setAttachmentError("That file is larger than 10MB.");
      setFile(null);
      e.target.value = "";
      return;
    }
    if (!ACCEPTED_ATTACHMENT_TYPES.includes(selected.type)) {
      setAttachmentError(
        "That doesn't look like a PNG, JPEG, WEBP, or PDF — you can still try uploading it.",
      );
    }
    setFile(selected);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitDisabled) return;
    setPending(true);

    const result = isPromote
      ? await promoteFeedbackAction(slug, fromFeedback!.feedbackId, {
          subject,
          changeClass,
          area,
          priority,
        })
      : await fileTicketAction(
          slug,
          (() => {
            const formData = new FormData();
            formData.set("subject", subject);
            formData.set("changeClass", changeClass);
            formData.set("area", area);
            formData.set("priority", priority);
            formData.set("body", body);
            if (file) formData.set("attachment", file);
            return formData;
          })(),
        );

    setPending(false);

    if (result.ok) {
      toast.success(isPromote ? "Feedback promoted to a ticket." : "Ticket filed.");
      router.push(`/o/${slug}/tickets/${result.data!.ticketId}`);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {isPromote && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium">
            Promoting feedback from {fromFeedback!.submitterDisplayName}
          </p>
          <p className="mt-1 text-muted-foreground whitespace-pre-wrap">
            {fromFeedback!.body}
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="ticket-subject">Subject</Label>
        <Input
          id="ticket-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          required
          disabled={pending}
          className="mt-1"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="ticket-category">Category</Label>
          <div className="relative mt-1">
            <select
              id="ticket-category"
              value={changeClass}
              onChange={(e) => setChangeClass(e.target.value as ChangeClass)}
              disabled={pending}
              className={SELECT_CLASSES}
            >
              {CHANGE_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {CHANGE_CLASS_LABELS[c]}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>
        <div>
          <Label htmlFor="ticket-area">Area</Label>
          <div className="relative mt-1">
            <select
              id="ticket-area"
              value={area}
              onChange={(e) => setArea(e.target.value as TicketArea)}
              disabled={pending}
              className={SELECT_CLASSES}
            >
              {TICKET_AREAS.map((a) => (
                <option key={a} value={a}>
                  {TICKET_AREA_LABELS[a]}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>
        <div>
          <Label htmlFor="ticket-priority">Priority</Label>
          <div className="relative mt-1">
            <select
              id="ticket-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
              disabled={pending}
              className={SELECT_CLASSES}
            >
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TICKET_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>
      </div>

      {!isPromote && (
        <div>
          <Label htmlFor="ticket-body">Description</Label>
          <Textarea
            id="ticket-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            maxLength={5000}
            required
            disabled={pending}
            className="mt-1"
          />
        </div>
      )}

      {!isPromote && (
        <div>
          <Label htmlFor="ticket-attachment">
            Attachment{" "}
            <span className="font-normal text-muted-foreground">
              (optional — PNG, JPEG, WEBP, or PDF, up to 10MB)
            </span>
          </Label>
          <Input
            id="ticket-attachment"
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
      )}

      <Button type="submit" disabled={isSubmitDisabled} className="min-h-11">
        {pending
          ? isPromote
            ? "Promoting…"
            : "Filing…"
          : isPromote
            ? "Promote to ticket"
            : "File ticket"}
      </Button>
    </form>
  );
}
