import { useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export default function CalendarSheet({ open, modal = true, onOpenChange, title, description, error, returnFocusRef, suppressRestoreRef, children, bulk = false, busy = false, focusKey, notice, placement = "viewport-right", portalContainer, restoreFocus = true }) {
  const headingRef = useRef(null);
  const openRef = useRef(open);
  const workspaceLeft = placement === "workspace-left";
  const [workspacePresent, setWorkspacePresent] = useState(open);
  useLayoutEffect(() => {
    openRef.current = open;
    if (open && focusKey) headingRef.current?.focus({ preventScroll: true });
  }, [focusKey, open]);
  useLayoutEffect(() => {
    if (!workspaceLeft) return undefined;
    if (open) {
      if (workspacePresent) return undefined;
      const frame = window.requestAnimationFrame(() => setWorkspacePresent(true));
      return () => window.cancelAnimationFrame(frame);
    }
    if (!workspacePresent) return undefined;
    const timer = window.setTimeout(() => setWorkspacePresent(false), 180);
    return () => window.clearTimeout(timer);
  }, [open, workspaceLeft, workspacePresent]);
  // Modal/mobile sheets unmount immediately. The workspace day panel remains
  // long enough for Radix Presence to run its left exit with pointer events off.
  if (!open && (!workspaceLeft || !workspacePresent)) return null;
  return (
    <Dialog open={open} modal={modal} onOpenChange={onOpenChange}>
      <DialogContent
        portalContainer={workspaceLeft ? portalContainer : undefined}
        className={workspaceLeft
          ? "calendar-sheet calendar-day-panel translate-x-0 translate-y-0 gap-0 p-0"
          : `calendar-sheet bottom-0 left-auto right-0 top-auto max-h-[95dvh] w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-b-none rounded-t-2xl p-0 sm:top-0 sm:h-dvh sm:max-h-none sm:max-w-[420px] sm:rounded-none sm:rounded-l-2xl ${bulk ? "calendar-sheet-bulk h-[95dvh]" : ""}`}
        showCloseButton={false}
        data-calendar-day-panel={workspaceLeft || undefined}
        onOpenAutoFocus={(event) => {
          if (!focusKey) return;
          event.preventDefault();
          headingRef.current?.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        onInteractOutside={(event) => {
          if (busy) { event.preventDefault(); return; }
          // A day sheet permits selecting another visible date directly. Keep
          // it mounted so outside-pointer dismissal cannot swallow that click.
          if (!modal && event.detail.originalEvent.target.closest?.("[data-calendar-workspace]")) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // Radix also unmounts a focus scope when switching from a nonmodal
          // day view to the modal editor. Only restore the calendar trigger
          // when the sheet actually closes, not during that mode transition.
          if (openRef.current) return;
          if (suppressRestoreRef?.current) {
            suppressRestoreRef.current = false;
            return;
          }
          if (restoreFocus) returnFocusRef.current?.focus({ preventScroll: true });
        }}
      >
        <header className="calendar-sheet-header flex shrink-0 items-start justify-between gap-3 border-b p-3">
          <div className="min-w-0">
            <DialogTitle ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">{title}</DialogTitle>
            <DialogDescription className="mt-1 text-xs">{description}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button type="button" variant="ghost" className="h-11 w-11 shrink-0 p-0" disabled={busy} aria-label="Close calendar panel"><X className="h-4 w-4" /></Button>
          </DialogClose>
        </header>
        {error ? <p role="alert" className="shrink-0 border-b border-status-danger-border bg-status-danger-surface p-3 text-sm text-status-danger">{error}</p> : null}
        {notice}
        <DialogBody className="calendar-sheet-body overscroll-contain p-3">{children}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}
