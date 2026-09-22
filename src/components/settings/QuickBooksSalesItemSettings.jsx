import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const typeLabel = (item) => item.type === "NonInventory" ? "Non-inventory" : "Service";
function ItemContext({ item }) {
  return <>
    <span className="block break-words font-medium">{item.name}</span>
    <span className="block break-words text-xs text-text-secondary">{typeLabel(item)} · {item.incomeAccountName}</span>
    {item.fullyQualifiedName !== item.name && <span className="block break-words text-xs text-text-secondary">{item.fullyQualifiedName}</span>}
    {item.code && <span className="block break-words text-xs text-text-secondary">SKU: {item.code}</span>}
  </>;
}

export default function QuickBooksSalesItemSettings({ items, accounts, value, onChange, onCreate, disabled, creationDisabled, companyName }) {
  const [dialog, setDialog] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);
  const [incomeAccountId, setIncomeAccountId] = useState("");
  const [error, setError] = useState("");
  const selected = items.find(item => item.id === value);
  const dedicated = items.filter(item => item.name?.normalize("NFKC").trim().toLowerCase() === "elset services");
  const canReuse = dedicated.length === 1;
  const query = search.trim().toLowerCase();
  const matches = items.filter(item => [item.name, item.fullyQualifiedName, item.code, item.type, typeLabel(item), item.incomeAccountName].join(" ").toLowerCase().includes(query));
  async function create() {
    setError("");
    const result = await onCreate(incomeAccountId);
    if (result?.salesItem) setDialog("");
    else setError(result?.error || 'The sales item could not be confirmed. Try again.');
  }
  return <div className="min-w-0 space-y-2" role="group" aria-label="Default QuickBooks sales item">
    <p className="text-sm font-medium">Default QuickBooks sales item</p>
    <p className="text-xs text-text-secondary">ELSET uses this QuickBooks item when creating invoice lines in QuickBooks. Your ELSET descriptions, quantities and prices are still sent separately.</p>
    {selected ? <div className="rounded-lg border bg-card p-3 text-sm" data-quickbooks-selected-item={selected.id}><ItemContext item={selected} /></div>
      : <p className="text-sm text-text-secondary">{value ? "The saved item is no longer eligible. Choose an active sales item." : "No default sales item selected."}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" className="h-auto min-h-9 whitespace-normal" disabled={disabled || creationDisabled} onClick={() => { setError(""); setIncomeAccountId(""); setDialog("create"); }}>
        {canReuse ? 'Use "ELSET Services"' : 'Create "ELSET Services" in QuickBooks'}
      </Button>
      <Button type="button" size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal" disabled={disabled} onClick={() => { setSearch(""); setLimit(100); setDialog("existing"); }}>Use existing QuickBooks item</Button>
    </div>
    <Dialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !disabled) setDialog(""); }}>
      <DialogContent className="flex max-h-[85dvh] min-w-0 flex-col overflow-hidden sm:max-w-xl" showCloseButton={!disabled}
        onEscapeKeyDown={(event) => { if (disabled) event.preventDefault(); }} onInteractOutside={(event) => { if (disabled) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{dialog === "existing" ? "Choose QuickBooks sales item" : canReuse ? 'Use "ELSET Services"' : 'Create "ELSET Services" in QuickBooks'}</DialogTitle>
          <DialogDescription>{dialog === "existing" ? "Choose an active Service or Non-inventory item. Each result shows its income account." : `QuickBooks company: ${companyName}. ${canReuse ? "The existing item will be reused with its current income account." : "Create one active Service item using an existing income account you select."}`}</DialogDescription></DialogHeader>
        {dialog === "existing" ? <>
          <Input autoFocus aria-label="Search QuickBooks sales items" placeholder="Search name, SKU, type or income account" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(100); }} />
          <p className="text-xs text-text-secondary" role="status">{matches.length} matching items{matches.length > limit ? ` · Showing ${limit}` : ""}</p>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <ul className="divide-y divide-border" aria-label="QuickBooks sales items">{matches.slice(0, limit).map(item => <li key={item.id}>
              <button type="button" disabled={disabled} aria-label={`Use ${item.fullyQualifiedName}`} onClick={() => { onChange(item.id); setDialog(""); }}
                className="w-full rounded-md p-3 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"><ItemContext item={item} /></button>
            </li>)}</ul>
            {!matches.length && <p className="py-5 text-sm text-text-secondary">No matching active sales items.</p>}
            {matches.length > limit && <Button type="button" variant="outline" className="my-2 w-full" onClick={() => setLimit(current => current + 100)}>Show more items</Button>}
          </div>
        </> : <div className="min-h-0 space-y-3 overflow-y-auto text-sm">
          {canReuse ? <div className="rounded-lg border p-3"><ItemContext item={dedicated[0]} /></div> : <>
            <Label htmlFor="quickbooks-new-item-income">Income account for ELSET Services</Label>
            <select id="quickbooks-new-item-income" className="h-10 w-full min-w-0 rounded-lg border border-input bg-card px-2 text-sm text-foreground" disabled={disabled} value={incomeAccountId} onChange={event => setIncomeAccountId(event.target.value)}>
              <option value="" disabled>Choose an existing income account</option>
              {accounts.filter(account => account.type === "Income").map(account => <option key={account.id} value={account.id}>{account.code ? `${account.code} — ` : ""}{account.name}</option>)}
            </select>
            {!accounts.some(account => account.type === "Income") && <p role="alert">No active sales income accounts are available. Set up an appropriate income account in QuickBooks, then reload configuration.</p>}
          </>}
          <p className="text-xs text-text-secondary">If an eligible item named ELSET Services already exists, ELSET will reuse it with its current income account. Existing items and accounts will not be changed. Save the configuration afterwards to use this item as your default.</p>
          {error && <p role="alert" className="text-status-danger">{error}</p>}
        </div>}
        <DialogFooter><Button type="button" variant="outline" disabled={disabled} onClick={() => setDialog("")}>Cancel</Button>
          {dialog === "create" && <Button type="button" disabled={disabled || creationDisabled || (!canReuse && !incomeAccountId)} onClick={() => void create()}>{disabled ? "Working..." : canReuse ? "Use existing ELSET Services" : "Create sales item"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
