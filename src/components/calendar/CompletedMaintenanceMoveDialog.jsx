import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCalendarDate } from "./calendar-utils";

export default function CompletedMaintenanceMoveDialog({ move, busy, onConfirm, onCancel }) {
  return <Dialog open={Boolean(move)} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
    <DialogContent className="rounded-xl sm:max-w-sm" showCloseButton={!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>Move completed maintenance job?</DialogTitle>
        <DialogDescription>This job is already completed. Only this visit's scheduled date will change.</DialogDescription>
      </DialogHeader>
      <p className="text-sm">Move Job #{move?.jobNumber} from <strong>{formatCalendarDate(move?.from)}</strong> to <strong>{formatCalendarDate(move?.date)}</strong>?</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button disabled={busy} onClick={onConfirm}>{busy ? "Moving..." : "Move job"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
