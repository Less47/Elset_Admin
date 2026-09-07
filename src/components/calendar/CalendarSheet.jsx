import { useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export default function CalendarSheet({ open, modal = true, onOpenChange, title, description, error, returnFocusRef, children, bulk = false, busy = false, focusKey, notice }) {
  const headingRef = useRef(null);
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
    if (open && focusKey) headingRef.current?.focus({ preventScroll: true });
  }, [focusKey, open]);
  // Unmount the dialog, focus scope and overlay together on close. An exiting
  // animation must not intercept the next calendar gesture.
  if (!open) return null;
  return (
    <Dialog open={open} modal={modal} onOpenChange={onOpenChange}>
      <DialogContent
        className={`calendar-sheet bottom-0 left-auto right-0 top-auto max-h-[95dvh] w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-b-none rounded-t-2xl p-0 sm:top-0 sm:h-dvh sm:max-h-none sm:max-w-[420px] sm:rounded-none sm:rounded-l-2xl ${bulk ? "calendar-sheet-bulk h-[95dvh]" : ""}`}
        showCloseButton={false}
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
          if (!modal && event.detail.originalEvent.target.closest?.("[data-calendar-main]")) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // Radix also unmounts a focus scope when switching from a nonmodal
          // day view to the modal editor. Only restore the calendar trigger
          // when the sheet actually closes, not during that mode transition.
          if (!openRef.current) returnFocusRef.current?.focus({ preventScroll: true });
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
        {error ? <p role="alert" className="shrink-0 border-b border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
        {notice}
        <DialogBody className="calendar-sheet-body overscroll-contain p-3">{children}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}
