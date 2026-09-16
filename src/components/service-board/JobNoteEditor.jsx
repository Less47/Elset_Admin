import { useId, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeServiceBoardNote, SERVICE_BOARD_NOTE_MAX_LENGTH } from "@/lib/service-board-note";

export default function JobNoteEditor({ editor, existingNote, onClose, onSave }) {
  const [value, setValue] = useState(editor.value);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const inputId = useId();
  const countId = useId();
  return (
    <Popover.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Popover.Anchor virtualRef={{ current: editor.anchor }} />
      <Popover.Portal>
        <Popover.Content
          data-slot="dialog-content"
          aria-label={`Job note for Job #${editor.jobNumber}`}
          side="bottom"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          className="z-[100] w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl outline-none"
          onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}
          onCloseAutoFocus={(event) => { event.preventDefault(); if (editor.anchor?.isConnected) editor.anchor.focus(); }}
        >
          <form onSubmit={(event) => {
            event.preventDefault();
            try { onSave(normalizeServiceBoardNote(value)); }
            catch (failure) { setError(failure.message); }
          }}>
            <Label htmlFor={inputId}>Job note</Label>
            <Input
              ref={inputRef}
              id={inputId}
              className="mt-2 h-11 text-base"
              value={value}
              onChange={(event) => { setValue(event.target.value); setError(""); }}
              maxLength={SERVICE_BOARD_NOTE_MAX_LENGTH}
              aria-describedby={countId}
              aria-invalid={Boolean(error)}
              autoComplete="off"
            />
            <p id={countId} className="mt-1 text-right text-xs text-muted-foreground">{value.length} / {SERVICE_BOARD_NOTE_MAX_LENGTH}</p>
            {error ? <p role="alert" className="mt-1 text-xs text-status-danger">{error}</p> : null}
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button>
              <Button type="submit" className="min-h-11">Save</Button>
            </div>
            {existingNote ? (
              <Button type="button" variant="ghost" className="mt-1 min-h-11 w-full text-status-danger" onClick={() => onSave(null)}>Remove note</Button>
            ) : null}
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
