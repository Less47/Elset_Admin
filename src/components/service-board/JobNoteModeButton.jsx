import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function JobNoteModeButton({ active, onToggle, mobile = false }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Edit job notes"
      aria-pressed={active}
      title="Edit job notes"
      onClick={onToggle}
      className={`shrink-0 rounded-xl ${mobile ? "h-11 w-11" : "h-8 w-8 max-lg:h-11 max-lg:w-11"} ${active
        ? "border-board-note-border bg-board-note text-board-note-foreground ring-2 ring-board-note-border hover:bg-board-note-hover"
        : "border-border bg-card text-text-secondary hover:bg-muted"}`}
    >
      <Pencil className="h-4 w-4" />
    </Button>
  );
}
