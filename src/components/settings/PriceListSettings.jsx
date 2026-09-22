import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { filterPriceList, priceListUnits, priceListTaxLabel } from "@/lib/price-list";
import { money } from "@/lib/quote-template";
import { priceListRequest, usePriceList } from "@/hooks/usePriceList";

const emptyItem = () => ({ name: "", description: "", code: "", unit: "each", unitPrice: "", taxTreatment: "taxable", category: "", archived: false });
const selectClass = "h-10 w-full rounded-md border border-input bg-input-surface px-3 text-sm text-foreground";

export default function PriceListSettings({ fetchWithAuth }) {
  const { items, loading, error: loadError, refresh } = usePriceList(fetchWithAuth);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const visible = filterPriceList(items, search, status);
  const edit = (item) => { setDraft({ ...item }); setError(""); setMessage(""); };
  const change = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await priceListRequest(fetchWithAuth, draft.id ? `/${encodeURIComponent(draft.id)}` : "", { method: draft.id ? "PATCH" : "POST", body: JSON.stringify(draft) });
      setDraft(null); setMessage("Item saved."); await refresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function archive(item) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await priceListRequest(fetchWithAuth, `/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify({ archived: !item.archived, updatedAt: item.updatedAt }) });
      setMessage(item.archived ? "Item restored to the active price list." : "Item archived. Existing document lines are unchanged."); await refresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Card className="rounded-3xl border-border shadow-sm">
    <CardHeader className="flex flex-wrap items-start justify-between gap-4 sm:flex-row">
      <div><CardTitle>Items &amp; Price List</CardTitle><p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">One shared list for quotes and invoices. Prices are ex GST. Adding an item copies its current values into an editable line; saved documents keep their own prices.</p></div>
      <Button onClick={() => edit(emptyItem())} disabled={busy}><Plus className="h-4 w-4" />Add item</Button>
    </CardHeader>
    <CardContent className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div className="relative"><Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Search price list" placeholder="Search name, code or description" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" /></div>
        <select aria-label="Price-list status" className={selectClass} value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All items</option></select>
      </div>
      {message && <p role="status" className="text-sm text-status-success">{message}</p>}
      {(loadError || (error && !draft)) && <div role="alert" className="text-sm text-status-danger">{loadError || error}<Button variant="outline" className="ml-3" onClick={() => refresh()}>Reload list</Button></div>}
      {loading ? <p role="status" className="text-sm text-text-secondary">Loading items...</p> : !visible.length ? <p className="py-8 text-center text-sm text-text-secondary">{search ? "No matching items." : status === "archived" ? "No archived items." : "No items yet. Add your first reusable item, or keep using blank document lines."}</p> :
        <ul className="divide-y divide-border" aria-label="Price-list items">{visible.map((item) => <li key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" aria-label={item.name}>
          <div className="min-w-0 flex-1"><p className="break-words font-semibold">{item.name}{item.archived ? <span className="ml-2 text-xs font-normal text-muted-foreground">Archived</span> : null}</p>
            {item.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-secondary">{item.description}</p>}
            <p className="mt-1 break-words text-xs text-muted-foreground">{[item.code, item.category].filter(Boolean).join(" · ")}</p>
            <p className="mt-2 text-sm"><span className="font-medium">{money(item.unitPrice)}</span> / {item.unit} <span className="text-text-secondary">ex GST · 10% GST</span></p>
          </div>
          <div className="flex shrink-0 gap-2"><Button variant="outline" onClick={() => edit(item)} disabled={busy}>Edit</Button><Button variant="outline" onClick={() => archive(item)} disabled={busy}>{item.archived ? "Restore" : "Archive"}</Button></div>
        </li>)}</ul>}
      <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open && !busy) { setDraft(null); setError(""); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{draft?.id ? "Edit price-list item" : "Add price-list item"}</DialogTitle><DialogDescription>Changes apply when items are added to a document. Existing lines stay unchanged.</DialogDescription></DialogHeader>
          {draft && <form onSubmit={save} className="space-y-4">
            <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="price-item-name">Name</Label><Input id="price-item-name" autoFocus required maxLength={200} value={draft.name} onChange={(event) => change("name", event.target.value)} /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="price-item-description">Description</Label><Textarea id="price-item-description" maxLength={2000} value={draft.description} onChange={(event) => change("description", event.target.value)} /><p className="text-xs text-muted-foreground">Used as the document line description. If blank, the item name is used.</p></div>
              <div className="space-y-2"><Label htmlFor="price-item-code">Item code / SKU (optional)</Label><Input id="price-item-code" maxLength={100} value={draft.code} onChange={(event) => change("code", event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="price-item-category">Category (optional)</Label><Input id="price-item-category" maxLength={100} value={draft.category} onChange={(event) => change("category", event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="price-item-unit">Unit</Label><select id="price-item-unit" className={selectClass} value={draft.unit} onChange={(event) => change("unit", event.target.value)}>{priceListUnits.map((unit) => <option key={unit}>{unit}</option>)}</select></div>
              <div className="space-y-2"><Label htmlFor="price-item-price">Unit price ex GST</Label><Input id="price-item-price" type="number" inputMode="decimal" min="0" max="999999999.99" step="0.01" required value={draft.unitPrice} onChange={(event) => change("unitPrice", event.target.value)} /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="price-item-tax">Tax treatment</Label><select id="price-item-tax" className={selectClass} value={draft.taxTreatment} disabled><option value="taxable">{priceListTaxLabel}</option></select><p className="text-xs text-muted-foreground">Uses ELSET’s existing 10% GST calculation. Units are stored for reference; document and PDF totals use quantity and rate.</p></div>
            </fieldset>
            {error && <p role="alert" className="text-sm text-status-danger">{error}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save item"}</Button></DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>;
}
