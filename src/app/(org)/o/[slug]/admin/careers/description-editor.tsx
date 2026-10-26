"use client";

import { useDeferredValue, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DESCRIPTION_MAX } from "@/lib/careers/contract";
import { validateDescription } from "@/lib/careers/description";
import { htmlToMarkdown } from "@/lib/careers/html-to-markdown";
import { charCount } from "@/lib/careers/text";
import { applyToolbar, type ToolbarAction } from "@/lib/careers/toolbar";
import { DescriptionPreview } from "./description-preview";

/**
 * The description editor: a plain textarea, a toolbar, a live character count, a
 * list of problems with their line numbers, and a preview (docs/work-log/
 * 2026-10-25-careers-inc1.md, Phase 3; DECISION-266 - no editor dependency).
 *
 * THE TEXT IS THE MODEL. Whatever the toolbar, the paste converter or the keyboard does,
 * the value is markdown in the textarea, validated live by `validateDescription` - the
 * same function the server runs, so an error shown here is an error the save would
 * return. The toolbar is `applyToolbar` over the textarea's selection, then the selection
 * is restored so the next click works where the caret is.
 *
 * PASTE. When the clipboard carries HTML (Word, Google Docs, a web page) it is converted
 * to the markdown subset by `htmlToMarkdown` and inserted at the selection. When there is
 * no HTML, or the converter declines (oversize, no parser, nothing textual), the browser
 * pastes plain text as it always does. The editor hint tells the author to check the
 * preview afterwards; the converter is lossy by design and says so.
 *
 * 16px text (the `Textarea` primitive) so iOS does not zoom on focus; 44px toolbar
 * buttons that wrap onto further rows at 360px.
 */

const TOOLBAR: ReadonlyArray<{ action: ToolbarAction; label: string; className?: string }> = [
  { action: "heading", label: "Heading" },
  { action: "subheading", label: "Subheading" },
  { action: "bold", label: "Bold", className: "font-bold" },
  { action: "italic", label: "Italic", className: "italic" },
  { action: "bullets", label: "Bulleted list" },
  { action: "numbers", label: "Numbered list" },
  { action: "link", label: "Link" },
];

/** 20000 -> "20,000". Plain integer grouping; no `Intl`. */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function DescriptionEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const textareaId = `${id}-description`;
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const [selectionTick, setSelectionTick] = useState(0);

  // Restores the selection a toolbar click or a converted paste computed, after React has committed the new value.
  useLayoutEffect(() => {
    const el = ref.current;
    const sel = pendingSelection.current;
    if (!el || !sel) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(sel.start, sel.end);
  }, [selectionTick]);

  function commit(next: { value: string; start: number; end: number }) {
    pendingSelection.current = { start: next.start, end: next.end };
    onChange(next.value);
    setSelectionTick((tick) => tick + 1);
  }

  function runToolbar(action: ToolbarAction) {
    const el = ref.current;
    if (!el) return;
    commit(applyToolbar({ value, start: el.selectionStart, end: el.selectionEnd }, action));
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const html = event.clipboardData.getData("text/html");
    if (html === "") return; // plain text: the browser's own paste
    const converted = htmlToMarkdown(html);
    if (converted === null || converted.markdown === "") return;
    event.preventDefault();
    const el = event.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = value.slice(0, start) + converted.markdown + value.slice(end);
    const caret = start + converted.markdown.length;
    commit({ value: next, start: caret, end: caret });
  }

  const count = charCount(value);
  const overLimit = count > DESCRIPTION_MAX;
  const validation = validateDescription(value, { requireNonEmpty: false });
  const problems = validation.ok ? [] : validation.errors;
  // The preview re-renders the whole markdown on a change; deferring it keeps typing responsive.
  const previewBody = useDeferredValue(value);

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={textareaId}>Description</Label>
        <p id={hintId} className="mt-1 text-sm text-muted-foreground">
          Leave a blank line between paragraphs. Use the buttons to add headings, bold text, lists and links. Pasting
          from Word or Google Docs keeps headings, bold, italics, lists and links; check the preview afterwards.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="description-toolbar">
        {TOOLBAR.map(({ action, label, className }) => (
          <Button
            key={action}
            type="button"
            variant="outline"
            className={`min-h-11 min-w-11 ${className ?? ""}`}
            disabled={disabled}
            // Keep the textarea's selection: a button press would otherwise move focus first.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runToolbar(action)}
          >
            {label}
          </Button>
        ))}
      </div>

      <Textarea
        id={textareaId}
        ref={ref}
        value={value}
        rows={14}
        spellCheck
        disabled={disabled}
        aria-describedby={`${hintId} ${statusId}`}
        aria-invalid={problems.length > 0 || overLimit ? "true" : undefined}
        className="min-h-64 [overflow-wrap:anywhere]"
        onChange={(event) => onChange(event.target.value)}
        onPaste={handlePaste}
      />

      <div id={statusId} className="space-y-2">
        <p
          data-testid="description-count"
          className={`text-sm ${overLimit ? "text-destructive" : "text-muted-foreground"}`}
        >
          {grouped(count)} of {grouped(DESCRIPTION_MAX)} characters
        </p>
        {problems.length > 0 && (
          <ul aria-live="polite" className="space-y-1 text-sm text-destructive" data-testid="description-errors">
            {problems.map((problem, index) => (
              <li key={`${problem.code}-${problem.line}-${index}`} className="[overflow-wrap:anywhere]">
                {problem.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <DescriptionPreview body={previewBody} />
    </div>
  );
}
