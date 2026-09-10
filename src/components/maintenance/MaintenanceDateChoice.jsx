import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCalendarDate } from "@/components/calendar/calendar-utils";

export default function MaintenanceDateChoice({ open, from, to, busy, frequencyChanged = false, onChoose, onCancel }) {
  return <Dialog open={open} onOpenChange={(value) => { if (!value && !busy) onCancel(); }}>
    <DialogContent className="rounded-xl sm:max-w-sm" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>Change maintenance date</DialogTitle><DialogDescription>You are changing a recurring maintenance {frequencyChanged ? "schedule" : "date"}.{from !== to ? ` ${formatCalendarDate(from)} → ${formatCalendarDate(to)}.` : ""}</DialogDescription></DialogHeader>
      <div className="grid gap-2">
        <Button variant="outline" className="h-auto min-h-11 whitespace-normal py-2" disabled={busy || frequencyChanged} onClick={() => onChoose("occurrence")}>This occurrence only</Button>
        <p className="px-1 text-xs text-muted-foreground">Keep the other recurring dates unchanged.</p>
        <Button className="mt-1 h-auto min-h-11 whitespace-normal py-2" disabled={busy} onClick={() => onChoose("schedule")}>Change maintenance schedule</Button>
        <p className="px-1 text-xs text-muted-foreground">Change this visit and future dates. Saved job and completion history stays in place.</p>
        <Button variant="ghost" className="mt-1 h-11" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
