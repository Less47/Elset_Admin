import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function MaintenanceChecklistEditor({ items, onChange }) {
  function move(index, direction) {
    const next = [...items];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  }
  return <div className="maintenance-checklist-template">
    <ol className="grid gap-3">{items.map((item, index) => <li key={item.id} className="maintenance-template-check">
      <label className="min-w-0 flex-1 text-xs">{index + 1}. Checklist item
        <Input aria-label={`Checklist item ${index + 1}`} value={item.text} maxLength={2000} required onChange={event => onChange(items.map((entry, i) => i === index ? { ...entry, text: event.target.value } : entry))} />
      </label>
      <div className="flex gap-1 self-end"><Button className="h-11 w-11 xl:h-8 xl:w-8" type="button" variant="outline" size="icon" aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
        <Button className="h-11 w-11 xl:h-8 xl:w-8" type="button" variant="outline" size="icon" aria-label={`Move item ${index + 1} down`} disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
        <Button className="h-11 w-11 xl:h-8 xl:w-8" type="button" variant="outline" size="icon" aria-label={`Remove item ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>
    </li>)}</ol>
    {!items.length ? <p className="text-sm text-muted-foreground">No checklist items. Add items to build this plan's checklist.</p> : null}
    <Button className="mt-3 h-11" type="button" variant="outline" size="sm" disabled={items.length >= 310} onClick={() => onChange([...items, { id: crypto.randomUUID(), text: "" }])}><Plus className="h-4 w-4" />Add item</Button>
  </div>;
}
