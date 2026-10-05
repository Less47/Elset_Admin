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
    <table className="maintenance-checklist-table maintenance-template-editor" aria-label="Edit plan checklist"><thead><tr><th scope="col">No.</th><th scope="col">Checklist item</th><th scope="col">Actions</th></tr></thead>
      <tbody>{items.map((item, index) => <tr key={item.id} className="maintenance-template-check">
        <td className="maintenance-number-cell">{index + 1}</td>
        <td className="maintenance-template-text"><Input aria-label={`Checklist item ${index + 1}`} value={item.text} maxLength={2000} required onChange={event => onChange(items.map((entry, i) => i === index ? { ...entry, text: event.target.value } : entry))} /></td>
        <td className="maintenance-template-actions"><div><Button className="h-11 w-11 xl:h-8 xl:w-8" type="button" variant="ghost" size="icon" aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
          <Button className="h-11 w-11 xl:h-8 xl:w-8" type="button" variant="ghost" size="icon" aria-label={`Move item ${index + 1} down`} disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
          <Button className="h-11 w-11 xl:h-8 xl:w-8" type="button" variant="ghost" size="icon" aria-label={`Remove item ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div></td>
      </tr>)}</tbody></table>
    {!items.length ? <p className="text-sm text-muted-foreground">No checklist items. Add items to build this plan's checklist.</p> : null}
    <Button className="mt-3 h-11" type="button" variant="outline" size="sm" disabled={items.length >= 310} onClick={() => onChange([...items, { id: crypto.randomUUID(), text: "" }])}><Plus className="h-4 w-4" />Add item</Button>
  </div>;
}
