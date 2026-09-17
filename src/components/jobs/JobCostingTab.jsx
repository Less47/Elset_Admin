import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WorkspaceMessage, WorkspaceSection } from "@/components/workspace/RecordWorkspace";
import { COST_CATEGORIES, costTotalCents, parseMoneyCents } from "@/lib/job-costing";
import { invoiceToday } from "@/lib/invoice-account";

const currency = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const dateFormatter = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" });
const COST_FILTERS = [{ key: "all", label: "All" }, ...COST_CATEGORIES];

function money(cents) {
  if (!Number.isSafeInteger(cents)) return "—";
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  const amount = currency.formatToParts(absolute / 100n)
    .map((part) => part.type === "fraction" ? String(absolute % 100n).padStart(2, "0") : part.value).join("");
  return `${value < 0n ? "-" : ""}${amount}`;
}

function moneyInput(cents) {
  const value = BigInt(cents);
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function marginText(percent) {
  return Number.isFinite(percent) ? `${percent.toFixed(1)}%` : "—";
}

function costDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : "—";
}

function buildCostDraft(entry) {
  return {
    category: entry?.category || "materials",
    description: entry?.description || "",
    quantity: entry ? String(entry.quantity) : "1",
    unitCost: entry ? moneyInput(entry.unitCostCents) : "",
    supplier: entry?.supplier || "",
    costDate: entry?.costDate || invoiceToday(),
    notes: entry?.notes || "",
  };
}

async function requestCosting(fetchWithAuth, path, options = {}) {
  const response = await fetchWithAuth(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.result) {
    const error = new Error(payload?.error || "Job costing could not be loaded. Try again.");
    error.code = payload?.code;
    throw error;
  }
  return payload.result;
}

function Metric({ label, value, hint, tone = "", compact = false, metric }) {
  return <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 sm:block ${compact ? "" : "rounded-lg border px-3 py-2.5"} ${tone || (compact ? "" : "bg-surface-raised")}`}>
    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
    <dd data-costing-metric={metric} className={`${compact ? "text-base" : "text-xl sm:text-2xl"} break-words font-semibold tabular-nums sm:mt-1`}>{value}</dd>
    {hint ? <dd className="col-span-2 mt-0.5 text-xs text-muted-foreground">{hint}</dd> : null}
  </div>;
}

function CostEditor({ entry, busy, error, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => buildCostDraft(entry));
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  let total = null;
  let valid = false;
  let amountError = "";
  try {
    total = costTotalCents(draft.quantity, parseMoneyCents(draft.unitCost));
    valid = Boolean(draft.description.trim() && draft.costDate);
  } catch (cause) {
    if (draft.unitCost || draft.quantity !== "1") amountError = cause.message;
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
    <DialogContent className="max-h-[90dvh] sm:max-w-lg" showCloseButton={!busy}
      onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
      onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{entry ? "Edit cost" : "Add cost"}</DialogTitle>
        <DialogDescription>Record an actual direct cost for this job. Enter unit costs excluding GST.</DialogDescription>
      </DialogHeader>
      <form className="flex min-h-0 flex-1 flex-col gap-3" onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        onSave({ category: draft.category, description: draft.description.trim(), quantity: draft.quantity,
          unitCostCents: parseMoneyCents(draft.unitCost), supplier: draft.supplier.trim(), costDate: draft.costDate, notes: draft.notes.trim() });
      }}>
        <DialogBody className="space-y-3 px-0.5">
          {error ? <div role="alert"><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cost-category">Category *</Label>
              <Select value={draft.category} onValueChange={(value) => update("category", value)} disabled={busy}>
                <SelectTrigger id="cost-category" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{COST_CATEGORIES.map((category) => <SelectItem key={category.key} value={category.key}>{category.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost-date">Date *</Label>
              <Input id="cost-date" type="date" required value={draft.costDate} onChange={(event) => update("costDate", event.target.value)} disabled={busy} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cost-description">Description *</Label>
            <Input id="cost-description" autoFocus required maxLength={500} value={draft.description} onChange={(event) => update("description", event.target.value)} disabled={busy} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cost-quantity">Quantity</Label>
              <Input id="cost-quantity" required inputMode="decimal" value={draft.quantity} onChange={(event) => update("quantity", event.target.value)} disabled={busy} aria-describedby="cost-total" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost-unit">Unit cost (ex GST)</Label>
              <Input id="cost-unit" required inputMode="decimal" placeholder="0.00" value={draft.unitCost} onChange={(event) => update("unitCost", event.target.value)} disabled={busy} aria-describedby="cost-total" />
            </div>
          </div>
          <div id="cost-total" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2 text-sm" aria-live="polite">
            <span className="text-muted-foreground">Quantity × unit cost</span>
            <strong className="tabular-nums">{money(total)} <span className="font-normal text-muted-foreground">ex GST</span></strong>
          </div>
          {amountError ? <p className="text-xs text-status-danger" role="status">{amountError}</p> : null}
          {draft.category === "labour" ? <p className="text-xs text-muted-foreground">Use the internal labour cost, such as hours × cost per hour.</p> : null}
          <div className="space-y-1.5">
            <Label htmlFor="cost-supplier">Supplier</Label>
            <Input id="cost-supplier" maxLength={200} value={draft.supplier} onChange={(event) => update("supplier", event.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cost-notes">Notes</Label>
            <Textarea id="cost-notes" rows={2} maxLength={4000} value={draft.notes} onChange={(event) => update("notes", event.target.value)} disabled={busy} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={busy || !valid}>{busy ? "Saving…" : "Save cost"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function EntryActions({ entry, disabled, onEdit, onDelete }) {
  return <div className="flex items-center justify-end gap-0.5">
    <Button type="button" variant="ghost" size="icon-sm" className="max-lg:min-h-11 max-lg:min-w-11" disabled={disabled} aria-label={`Edit cost: ${entry.description}`} onClick={() => onEdit(entry)}><Pencil className="size-3.5" /></Button>
    <Button type="button" variant="ghost" size="icon-sm" className="max-lg:min-h-11 max-lg:min-w-11" disabled={disabled} aria-label={`Delete cost: ${entry.description}`} onClick={() => onDelete(entry)}><Trash2 className="size-3.5" /></Button>
  </div>;
}

export default function JobCostingTab({ jobId, canEdit, fetchWithAuth, onAddonDisabled }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const basePath = `/api/jobs/${encodeURIComponent(jobId)}`;
  const { visibleEntries, categoryCounts, visibleTotalCents } = useMemo(() => {
    const entries = summary?.entries || [];
    const counts = { all: entries.length };
    for (const entry of entries) counts[entry.category] = (counts[entry.category] || 0) + 1;
    const visible = categoryFilter === "all" ? entries : entries.filter((entry) => entry.category === categoryFilter);
    return { visibleEntries: visible, categoryCounts: counts,
      visibleTotalCents: visible.reduce((total, entry) => total + entry.totalCostCents, 0) };
  }, [summary?.entries, categoryFilter]);

  useEffect(() => {
    let current = true;
    requestCosting(fetchWithAuth, `${basePath}/costing`).then((result) => {
      if (!current) return;
      setSummary(result);
      setError("");
      setLoading(false);
    }).catch((cause) => {
      if (!current) return;
      setLoading(false);
      setError(cause.message);
      if (cause.code === "ADDON_DISABLED") {
        setSummary(null);
        onAddonDisabled?.();
      }
    });
    return () => { current = false; };
  }, [basePath, fetchWithAuth, onAddonDisabled, retry]);

  const refresh = () => {
    setLoading(true);
    setError("");
    setRetry((value) => value + 1);
  };
  const openEditor = (entry = null) => { setActionError(""); setEditor({ entry }); };
  const openDelete = (entry) => { setActionError(""); setDeleting(entry); };

  const mutate = async (path, method, body) => {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await requestCosting(fetchWithAuth, path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      setSummary(result);
      setError("");
      setEditor(null);
      setDeleting(null);
    } catch (cause) {
      setActionError(cause.message);
      if (cause.code === "ADDON_DISABLED") { setSummary(null); onAddonDisabled?.(); }
    } finally {
      setBusy(false);
    }
  };

  const addButton = canEdit ? <Button type="button" size="sm" className="max-lg:min-h-11" disabled={loading || busy || !summary} onClick={() => openEditor()}><Plus className="size-4" /> Add Cost</Button> : null;
  const profitTone = summary?.grossProfitCents < 0 ? "border-status-danger-border bg-status-danger-surface text-status-danger"
    : summary?.grossProfitCents > 0 ? "border-status-success-border bg-status-success-surface text-status-success" : "";
  const categoryLabel = (key) => COST_CATEGORIES.find((category) => category.key === key)?.label || key;

  return <WorkspaceSection title="Job costing" description="Sent or paid invoice revenue and direct costs, excluding GST." trailing={<div className="flex items-center gap-1">
    <Button type="button" variant="ghost" size="icon-sm" className="max-lg:min-h-11 max-lg:min-w-11" aria-label="Refresh costing" disabled={loading || busy} onClick={refresh}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></Button>{addButton}
  </div>}>
    <div className="space-y-4" data-testid="job-costing">
      {error ? <div role="alert"><WorkspaceMessage tone="error">{error} <Button variant="link" className="h-auto p-0 text-inherit" onClick={refresh}>Retry</Button></WorkspaceMessage></div> : null}
      {loading && !summary ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading job costing…</p> : null}
      {summary ? <>
        <dl aria-label="Profitability" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Metric metric="revenue" label="Revenue" value={money(summary.revenueCents)} hint="Ex GST" />
          <Metric metric="total-costs" label="Total costs" value={money(summary.totalCostCents)} hint="Ex GST" />
          <Metric metric="gross-profit" label="Gross profit" value={money(summary.grossProfitCents)} hint="Ex GST" tone={profitTone} />
          <Metric metric="margin" label="Margin" value={marginText(summary.marginPercent)} hint={summary.revenueCents === 0 ? "No invoice revenue yet" : "Gross profit ÷ revenue"} />
        </dl>

        <section aria-label="Commercial summary" className="border-y py-3">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric metric="quoted" compact label="Quoted" value={summary.quoteCount ? money(summary.quotedCents) : "—"} hint={summary.quoteCount ? "Ex GST · comparison only" : "No quote"} />
            <Metric metric="invoiced" compact label="Invoiced" value={money(summary.invoicedCents)} hint="Ex GST" />
            <Metric metric="paid" compact label="Paid" value={money(summary.paidCents)} hint="Including GST" />
            <Metric metric="outstanding" compact label="Outstanding" value={money(summary.outstandingCents)} hint="Including GST" />
          </dl>
          {summary.varianceCents !== null ? <p className="mt-3 text-xs text-muted-foreground">Quote/invoice variance: <strong className="font-medium text-foreground tabular-nums">{summary.varianceCents > 0 ? "+" : ""}{money(summary.varianceCents)}</strong> ex GST</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">Paid and outstanding track invoice payments. Profit uses invoice revenue.</p>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section aria-labelledby="cost-breakdown-title">
            <h3 id="cost-breakdown-title" className="mb-2 text-sm font-semibold">Cost breakdown</h3>
            <dl className="space-y-1.5">
              {summary.categories.map((category) => <div key={category.key} className="grid grid-cols-[minmax(0,1fr)_auto_2.75rem] items-baseline gap-2 text-sm">
                <dt className="min-w-0 text-muted-foreground">{category.label}</dt><dd className="tabular-nums">{money(category.totalCostCents)}</dd>
                <dd className="text-right text-xs text-muted-foreground tabular-nums">{Number.isFinite(category.percent) ? `${Math.round(category.percent)}%` : "0%"}</dd>
              </div>)}
            </dl>
          </section>
          <section aria-labelledby="profit-summary-title" className="border-t pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
            <h3 id="profit-summary-title" className="mb-2 text-sm font-semibold">Profit summary</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Revenue</dt><dd className="tabular-nums">{money(summary.revenueCents)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Costs</dt><dd className="tabular-nums">−{money(summary.totalCostCents)}</dd></div>
              <div className="flex justify-between gap-3 border-t pt-2 font-semibold"><dt>Gross profit</dt><dd className={`tabular-nums ${summary.grossProfitCents < 0 ? "text-status-danger" : ""}`}>{money(summary.grossProfitCents)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Margin</dt><dd className="tabular-nums">{marginText(summary.marginPercent)}</dd></div>
            </dl>
          </section>
        </div>

        <section aria-labelledby="cost-entries-title" className="border-t pt-3">
          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
            <h3 id="cost-entries-title" className="whitespace-nowrap text-sm font-semibold">Cost entries <span className="ml-1 font-normal text-muted-foreground">({categoryFilter === "all" ? summary.entries.length : `${visibleEntries.length} of ${summary.entries.length}`})</span></h3>
            <div role="group" aria-label="Filter cost entries by category" className="col-span-2 row-start-2 flex min-w-0 gap-1 overflow-x-auto overscroll-x-contain p-0.5 [scrollbar-width:thin] lg:col-span-1 lg:col-start-2 lg:row-start-1">
              {COST_FILTERS.map((category) => <Button key={category.key} type="button" size="xs"
                variant={categoryFilter === category.key ? "default" : "ghost"}
                className="h-7 gap-1 rounded-full max-lg:min-h-8 max-lg:min-w-8"
                aria-pressed={categoryFilter === category.key} onClick={() => setCategoryFilter(category.key)}>
                {category.label}<span className="text-[10px] tabular-nums">({categoryCounts[category.key] || 0})</span>
              </Button>)}
            </div>
            {canEdit ? <div className="col-start-2 row-start-1 justify-self-end lg:col-start-3">{addButton}</div> : null}
          </div>
          {visibleEntries.length ? <>
            <table className="hidden w-full table-fixed text-sm md:table">
              <thead className="border-b text-left text-xs text-muted-foreground"><tr>
                <th className="w-[14%] py-2 font-medium">Date</th><th className="w-[16%] py-2 font-medium">Category</th><th className="py-2 font-medium">Description</th>
                <th className="w-[7%] py-2 text-right font-medium">Qty</th><th className="w-[13%] py-2 text-right font-medium">Unit cost</th><th className="w-[14%] py-2 text-right font-medium">Total</th>{canEdit ? <th className="w-[6.25rem] lg:w-[5rem]"><span className="sr-only">Actions</span></th> : null}
              </tr></thead>
              <tbody>{visibleEntries.map((entry) => <tr key={entry.id} className="border-b align-top last:border-0">
                <td className="py-2 pr-2 text-xs text-muted-foreground">{costDate(entry.costDate)}</td>
                <td className="break-words py-2 pr-2 text-xs">{categoryLabel(entry.category)}</td>
                <td className="break-words py-2 pr-2"><span className="font-medium">{entry.description}</span>{entry.supplier ? <span className="mt-0.5 block text-xs text-muted-foreground">{entry.supplier}</span> : null}</td>
                <td className="break-words py-2 text-right text-xs tabular-nums">{entry.quantity}</td>
                <td className="break-words py-2 pl-2 text-right text-xs tabular-nums">{money(entry.unitCostCents)}</td>
                <td className="break-words py-2 pl-2 text-right text-xs font-medium tabular-nums">{money(entry.totalCostCents)}</td>
                {canEdit ? <td className="py-1 pl-2"><EntryActions entry={entry} disabled={loading || busy} onEdit={openEditor} onDelete={openDelete} /></td> : null}
              </tr>)}</tbody>
            </table>
            <ul className="divide-y md:hidden">{visibleEntries.map((entry) => <li key={entry.id} className="py-3 first:pt-1">
              <div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words font-medium">{entry.description}</p><strong className="shrink-0 text-sm tabular-nums">{money(entry.totalCostCents)}</strong></div>
              <p className="mt-1 text-xs text-muted-foreground">{categoryLabel(entry.category)} · {costDate(entry.costDate)}</p>
              {entry.supplier ? <p className="mt-1 break-words text-xs text-muted-foreground">{entry.supplier}</p> : null}
              <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground tabular-nums">{entry.quantity} × {money(entry.unitCostCents)} ex GST</p>{canEdit ? <EntryActions entry={entry} disabled={loading || busy} onEdit={openEditor} onDelete={openDelete} /> : null}</div>
            </li>)}</ul>
          </> : <WorkspaceMessage>{categoryFilter === "all"
            ? `No costs recorded yet.${canEdit ? " Add materials, labour or another direct job cost." : ""}`
            : `No ${categoryLabel(categoryFilter)} cost entries.`}</WorkspaceMessage>}
          <div className="flex justify-between gap-3 border-t pt-2 text-sm font-semibold" data-testid="cost-entries-subtotal"><span>{categoryFilter === "all" ? "Total costs" : `${categoryLabel(categoryFilter)} subtotal`} <span className="font-normal text-muted-foreground">ex GST</span></span><span className="tabular-nums">{money(visibleTotalCents)}</span></div>
        </section>
      </> : null}
    </div>

    {editor ? <CostEditor key={editor.entry?.id || "new"} entry={editor.entry} busy={busy} error={actionError} onCancel={() => setEditor(null)} onSave={(body) => mutate(editor.entry ? `${basePath}/costs/${encodeURIComponent(editor.entry.id)}` : `${basePath}/costs`, editor.entry ? "PATCH" : "POST", body)} /> : null}
    <Dialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}>
      <DialogContent className="sm:max-w-sm" showCloseButton={!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>Delete cost?</DialogTitle><DialogDescription>Remove “{deleting?.description}” from this job? Cost totals and profit will be recalculated.</DialogDescription></DialogHeader>
        {actionError ? <div role="alert"><WorkspaceMessage tone="error">{actionError}</WorkspaceMessage></div> : null}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => mutate(`${basePath}/costs/${encodeURIComponent(deleting.id)}`, "DELETE")}>{busy ? "Deleting…" : "Delete cost"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </WorkspaceSection>;
}
