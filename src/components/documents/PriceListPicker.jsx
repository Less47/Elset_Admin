import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { priceListRequest, usePriceList } from "@/hooks/usePriceList";
import { filterPriceList, priceListItemToLine } from "@/lib/price-list";
import { money } from "@/lib/quote-template";

export default function PriceListPicker({ fetchWithAuth, onAdd, onClose }) {
  const { items, loading, error: loadError, refresh } = usePriceList(fetchWithAuth, "active");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const visible = filterPriceList(items, search);
  async function select(item) {
    if (adding) return;
    setAdding(true); setError("");
    try {
      // Re-read at selection to catch edits or archiving in another tab.
      const current = await priceListRequest(fetchWithAuth, `/${encodeURIComponent(item.id)}`);
      onAdd(priceListItemToLine(current.item)); onClose();
    } catch (failure) { setError(failure.message); setAdding(false); await refresh(); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !adding) onClose(); }}>
    <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-xl">
      <DialogHeader><DialogTitle>Add from price list</DialogTitle><DialogDescription>Choose an item to copy into this document. You can edit its description, quantity and rate afterwards.</DialogDescription></DialogHeader>
      <Input autoFocus aria-label="Search price list" placeholder="Search name, code or description" value={search} onChange={(event) => setSearch(event.target.value)} />
      {(error || loadError) && <div role="alert" className="text-sm text-status-danger">{error || loadError}<Button variant="outline" className="ml-2" onClick={() => refresh()}>Reload list</Button></div>}
      <div className="min-h-0 overflow-y-auto overscroll-contain" aria-busy={loading || adding}>
        {loading ? <p role="status" className="py-6 text-sm">Loading items...</p> : !visible.length ? <p className="py-6 text-sm text-text-secondary">{search ? "No matching active items." : "No active items. Add items in Settings → Items & Price List, or use Add blank line."}</p> :
          <ul className="divide-y divide-border" aria-label="Available price-list items">{visible.map((item) => <li key={item.id}>
            <button type="button" disabled={adding} onClick={() => select(item)} aria-label={`Add ${item.name}`} className="w-full rounded-md px-2 py-4 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:opacity-50">
              <span className="block break-words font-medium">{item.name}</span>
              {item.code && <span className="mt-1 block break-words text-xs text-muted-foreground">{item.code}</span>}
              {item.description && <span className="mt-1 block whitespace-pre-wrap break-words text-sm text-text-secondary">{item.description}</span>}
              <span className="mt-2 block text-sm">{money(item.unitPrice)} / {item.unit} <span className="text-text-secondary">ex GST · 10% GST</span></span>
            </button>
          </li>)}</ul>}
      </div>
      <Button type="button" variant="outline" disabled={adding} onClick={onClose}>Cancel</Button>
    </DialogContent>
  </Dialog>;
}
