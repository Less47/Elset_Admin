import { LockKeyhole, ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STANDARD_MAINTENANCE_CHECKLIST } from "@/lib/maintenance-checklist";

export default function MaintenanceChecklistEditor({ items, onChange }) {
  function move(index, direction) {
    const next = [...items];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  }
  return <div className="maintenance-checklist-template">
    <details><summary className="cursor-pointer text-sm font-medium">10 standard checks · locked</summary>
      <ol className="mt-3 grid list-decimal gap-2 pl-5 text-sm text-text-secondary">
        {STANDARD_MAINTENANCE_CHECKLIST.map(item => <li key={item.key}><span>{item.text}</span> <LockKeyhole className="inline h-3 w-3" aria-label="Standard, locked" /></li>)}
      </ol>
    </details>
    <p className="mt-4 text-xs font-semibold uppercase text-muted-foreground">Additional checks ({items.length})</p>
    <ol className="mt-2 grid gap-2" start={11}>{items.map((item, index) => <li key={item.id} className="maintenance-custom-check">
      <label className="min-w-0 flex-1 text-xs">{index + 11}. Additional check
        <Input aria-label={`Additional check ${index + 1}`} value={item.text} maxLength={2000} required onChange={event => onChange(items.map((entry, i) => i === index ? { ...entry, text: event.target.value } : entry))} />
      </label>
      <div className="flex gap-1 self-end"><Button type="button" variant="outline" size="icon" aria-label={`Move additional check ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="icon" aria-label={`Move additional check ${index + 1} down`} disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="icon" aria-label={`Remove additional check ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>
    </li>)}</ol>
    <Button className="mt-3" type="button" variant="outline" size="sm" disabled={items.length >= 300} onClick={() => onChange([...items, { id: crypto.randomUUID(), text: "", standard: false }])}><Plus className="h-4 w-4" />Add check</Button>
  </div>;
}
