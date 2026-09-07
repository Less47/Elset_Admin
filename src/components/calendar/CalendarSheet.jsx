import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export default function CalendarSheet({ open, onOpenChange, title, description, error, returnFocusRef, children }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="calendar-sheet bottom-0 left-auto right-0 top-auto max-h-[95dvh] w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-b-none rounded-t-2xl p-0 sm:top-0 sm:h-dvh sm:max-h-none sm:max-w-[420px] sm:rounded-none sm:rounded-l-2xl"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus({ preventScroll: true });
        }}
      >
        <header className="calendar-sheet-header flex shrink-0 items-start justify-between gap-3 border-b p-3">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
            <DialogDescription className="mt-1 text-xs">{description}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button type="button" variant="ghost" className="h-11 w-11 shrink-0 p-0" aria-label="Close calendar panel"><X className="h-4 w-4" /></Button>
          </DialogClose>
        </header>
        {error ? <p role="alert" className="shrink-0 border-b border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
        <DialogBody className="calendar-sheet-body overscroll-contain p-3">{children}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}
