import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { FormField } from "@/components/shared/FormField";
import {
  MobileRecordActions,
  MobileRecordBody,
  MobileRecordCard,
  MobileRecordHeader,
  MobileRecordList,
  MobileRecordStat,
  MobileRecordStats,
} from "@/components/shared/MobileRecordList";
import { useMobileRecordLayout } from "@/hooks/useMobileRecordLayout";
import {
  CompactSortControl,
  DesktopControlField,
  DesktopPageControls,
  FilterButton,
  FilterSheetField,
  MobileFilterSheet,
  PagePrimaryAction,
  PageSearchField,
  ResponsivePageControls,
  ResultSummary,
} from "@/components/shared/ResponsivePageControls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getInventoryStockStatus,
  inventoryCategories,
  normalizeInventoryRecord,
  normalizeNumber,
  toTimestamp,
} from "@/lib/app-support";
import { money } from "@/lib/quote-template";

const inventorySortOptions = [
  { value: "name-asc", label: "A-Z" },
  { value: "name-desc", label: "Z-A" },
  { value: "stock-low", label: "Lowest stock" },
  { value: "stock-high", label: "Highest stock" },
  { value: "value-high", label: "Highest value" },
  { value: "updated-recent", label: "Recently updated" },
];

function InventoryItemDialog({ open, onOpenChange, initialPart, onSave }) {
  const [draftPart, setDraftPart] = useState({
    name: "",
    sku: "",
    category: "Automation",
    supplier: "",
    location: "",
    quantity: "0",
    reorderLevel: "0",
    unitCost: "0",
    notes: "",
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setDraftPart({
      name: initialPart?.name || "",
      sku: initialPart?.sku || "",
      category: initialPart?.category || "Automation",
      supplier: initialPart?.supplier || "",
      location: initialPart?.location || "",
      quantity: String(initialPart?.quantity ?? 0),
      reorderLevel: String(initialPart?.reorderLevel ?? 0),
      unitCost: String(initialPart?.unitCost ?? 0),
      notes: initialPart?.notes || "",
    });
  }, [initialPart, open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const canSave = draftPart.name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] rounded-3xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{initialPart ? "Edit Part" : "Add Part"}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <div className="grid gap-4">
            <FormField label="Part name">
              <Input
                value={draftPart.name}
                onChange={(e) => setDraftPart((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. FAAC remote, 12V battery, gate hinge"
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="SKU / code">
                <Input value={draftPart.sku} onChange={(e) => setDraftPart((prev) => ({ ...prev, sku: e.target.value }))} />
              </FormField>
              <FormField label="Category">
                <Select value={draftPart.category} onValueChange={(value) => setDraftPart((prev) => ({ ...prev, category: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {inventoryCategories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Supplier">
                <Input value={draftPart.supplier} onChange={(e) => setDraftPart((prev) => ({ ...prev, supplier: e.target.value }))} />
              </FormField>
              <FormField label="Storage location">
                <Input value={draftPart.location} onChange={(e) => setDraftPart((prev) => ({ ...prev, location: e.target.value }))} placeholder="Workshop, van, shelf..." />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Quantity on hand">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={draftPart.quantity}
                  onChange={(e) => setDraftPart((prev) => ({ ...prev, quantity: e.target.value }))}
                />
              </FormField>
              <FormField label="Reorder level">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={draftPart.reorderLevel}
                  onChange={(e) => setDraftPart((prev) => ({ ...prev, reorderLevel: e.target.value }))}
                />
              </FormField>
              <FormField label="Unit cost">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draftPart.unitCost}
                  onChange={(e) => setDraftPart((prev) => ({ ...prev, unitCost: e.target.value }))}
                />
              </FormField>
            </div>

            <FormField label="Notes">
              <Textarea
                rows={4}
                value={draftPart.notes}
                onChange={(e) => setDraftPart((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Compatibility, preferred supplier, install notes..."
              />
            </FormField>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={async () => {
              const didSave = onSave({
                name: draftPart.name,
                sku: draftPart.sku,
                category: draftPart.category,
                supplier: draftPart.supplier,
                location: draftPart.location,
                quantity: normalizeNumber(draftPart.quantity, 0),
                reorderLevel: normalizeNumber(draftPart.reorderLevel, 0),
                unitCost: normalizeNumber(draftPart.unitCost, 0),
                notes: draftPart.notes,
              });
              if (didSave instanceof Promise && (await didSave) === false) return;
              if (didSave !== false) onOpenChange(false);
            }}
          >
            {initialPart ? "Save Part" : "Create Part"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InventoryManager({ inventoryItems, onCreatePart, onUpdatePart, onDeletePart }) {
  const [search, setSearch] = useState("");
  const [filterBy, setFilterBy] = useState("all");
  const [sortBy, setSortBy] = useState("name-asc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [partDialogOpen, setPartDialogOpen] = useState(false);
  const [editingPart, setEditingPart] = useState(null);
  const filterTriggerRef = useRef(null);
  const deferredSearch = useDeferredValue(search);
  const isMobileRecordLayout = useMobileRecordLayout();

  const parts = useMemo(
    () => (inventoryItems || []).map(normalizeInventoryRecord).filter(Boolean),
    [inventoryItems]
  );

  const inventoryStats = useMemo(() => {
    return parts.reduce((stats, part) => {
      const status = getInventoryStockStatus(part);
      const stockValue = part.quantity * part.unitCost;

      return {
        totalParts: stats.totalParts + 1,
        totalUnits: stats.totalUnits + part.quantity,
        lowStock: stats.lowStock + (status.id === "low" ? 1 : 0),
        outOfStock: stats.outOfStock + (status.id === "out" ? 1 : 0),
        inventoryValue: stats.inventoryValue + stockValue,
      };
    }, {
      totalParts: 0,
      totalUnits: 0,
      lowStock: 0,
      outOfStock: 0,
      inventoryValue: 0,
    });
  }, [parts]);

  const filteredParts = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    const rows = parts.filter((part) => {
      const status = getInventoryStockStatus(part);
      const matchesSearch = query
        ? [part.name, part.sku, part.category, part.supplier, part.location, part.notes]
            .join(" ")
            .toLowerCase()
            .includes(query)
        : true;

      const matchesFilter =
        filterBy === "all"
          ? true
          : filterBy === "low-stock"
            ? status.id === "low" || status.id === "out"
            : filterBy === "out-of-stock"
              ? status.id === "out"
              : status.id === "in";

      return matchesSearch && matchesFilter;
    });

    rows.sort((a, b) => {
      if (sortBy === "name-desc") return b.name.localeCompare(a.name);
      if (sortBy === "stock-low") return a.quantity - b.quantity || a.name.localeCompare(b.name);
      if (sortBy === "stock-high") return b.quantity - a.quantity || a.name.localeCompare(b.name);
      if (sortBy === "value-high") return (b.quantity * b.unitCost) - (a.quantity * a.unitCost) || a.name.localeCompare(b.name);
      if (sortBy === "updated-recent") return toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt);
      return a.name.localeCompare(b.name);
    });

    return rows;
  }, [deferredSearch, filterBy, parts, sortBy]);
  const activeFilterCount = filterBy === "all" ? 0 : 1;

  return (
    <>
      <div className="space-y-4">
        <ResponsivePageControls
          search={(
            <PageSearchField value={search} onChange={setSearch} placeholder="Search parts..." label="Search parts inventory" />
          )}
          controls={(
            <>
              <FilterButton ref={filterTriggerRef} activeCount={activeFilterCount} open={filtersOpen} onClick={() => setFiltersOpen(true)} />
              <CompactSortControl value={sortBy} onValueChange={setSortBy} options={inventorySortOptions} label="Sort parts inventory" />
            </>
          )}
          action={(
            <PagePrimaryAction onClick={() => { setEditingPart(null); setPartDialogOpen(true); }}>
              <Plus className="h-4 w-4" /> Add Part
            </PagePrimaryAction>
          )}
          summary={<ResultSummary>{filteredParts.length} {filteredParts.length === 1 ? "part" : "parts"}</ResultSummary>}
        />

        <DesktopPageControls
          search={(
            <DesktopControlField label="Search" size="search">
              <PageSearchField
                compact
                value={search}
                onChange={setSearch}
                placeholder="Search part, SKU, supplier, or location..."
                label="Search parts inventory"
              />
            </DesktopControlField>
          )}
          filters={(
            <>
            <DesktopControlField htmlFor="desktop-inventory-stock-filter" label="Stock filter" size="medium">
              <Select value={filterBy} onValueChange={setFilterBy}>
                <SelectTrigger id="desktop-inventory-stock-filter" className="data-toolbar-field rounded-lg border-border bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All parts</SelectItem>
                  <SelectItem value="low-stock">Needs reorder</SelectItem>
                  <SelectItem value="out-of-stock">Out of stock</SelectItem>
                  <SelectItem value="in-stock">In stock</SelectItem>
                </SelectContent>
              </Select>
            </DesktopControlField>

            <DesktopControlField htmlFor="desktop-inventory-sort" label="Sort by" size="medium">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger id="desktop-inventory-sort" className="data-toolbar-field rounded-lg border-border bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name-asc">Name A-Z</SelectItem>
                  <SelectItem value="name-desc">Name Z-A</SelectItem>
                  <SelectItem value="stock-low">Lowest stock</SelectItem>
                  <SelectItem value="stock-high">Highest stock</SelectItem>
                  <SelectItem value="value-high">Highest value</SelectItem>
                  <SelectItem value="updated-recent">Recently updated</SelectItem>
                </SelectContent>
              </Select>
            </DesktopControlField>
            </>
          )}
          actions={(
            <PagePrimaryAction
              compact
              onClick={() => {
                setEditingPart(null);
                setPartDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add Part
            </PagePrimaryAction>
          )}
        />

        <Card className="data-card gap-0 overflow-hidden rounded-xl border-border shadow-none">
        <div className="data-stat-grid hidden gap-px border-b border-border bg-surface-selected xl:grid xl:grid-cols-4">
          {[
            { label: "Parts", value: inventoryStats.totalParts },
            { label: "Units on hand", value: inventoryStats.totalUnits },
            { label: "Needs reorder", value: inventoryStats.lowStock + inventoryStats.outOfStock },
            { label: "Stock value", value: money(inventoryStats.inventoryValue) },
          ].map((stat) => (
            <div key={stat.label} className="data-stat-card bg-card px-panel py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{stat.value}</p>
            </div>
          ))}
        </div>

        <CardContent className="p-0">
          {filteredParts.length === 0 ? (
            <div className="p-panel">
              <EmptyState
                title="No parts found"
                text="Add a part or adjust the search and filters to see inventory records."
                action={(
                  <Button
                    className="rounded-lg"
                    onClick={() => {
                      setEditingPart(null);
                      setPartDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add Part
                  </Button>
                )}
              />
            </div>
          ) : isMobileRecordLayout ? (
            <MobileRecordList className="p-2.5" label="Parts inventory records">
              {filteredParts.map((part) => {
                const status = getInventoryStockStatus(part);
                const stockValue = part.quantity * part.unitCost;
                const headingId = `mobile-inventory-${encodeURIComponent(part.id)}`;

                return (
                  <MobileRecordCard key={part.id} labelledBy={headingId} recordId={part.id}>
                    <MobileRecordHeader>
                      <div className="min-w-0">
                        <h3 id={headingId} className="line-clamp-2 font-semibold text-foreground [overflow-wrap:anywhere]">
                          {part.name}
                        </h3>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {part.sku || "No SKU"} - {part.category}
                        </p>
                      </div>
                      <Badge className={`${status.className} shrink-0`}>{status.label}</Badge>
                    </MobileRecordHeader>

                    <MobileRecordBody>
                      <p className="line-clamp-1">
                        <span className="font-medium text-muted-foreground">Supplier: </span>
                        <span className="text-foreground">{part.supplier || "Not set"}</span>
                      </p>
                      <p className="line-clamp-1">
                        <span className="font-medium text-muted-foreground">Location: </span>
                        <span className="text-foreground">{part.location || "Not set"}</span>
                      </p>
                    </MobileRecordBody>

                    <MobileRecordStats className="grid-cols-3">
                      <MobileRecordStat label="Qty">{part.quantity}</MobileRecordStat>
                      <MobileRecordStat label="Reorder">{part.reorderLevel}</MobileRecordStat>
                      <MobileRecordStat label="Value">{money(stockValue)}</MobileRecordStat>
                    </MobileRecordStats>

                    <MobileRecordActions>
                      <Button
                        variant="outline"
                        className="border-border px-3"
                        aria-label={`Edit part ${part.name}`}
                        onClick={() => {
                          setEditingPart(part);
                          setPartDialogOpen(true);
                        }}
                      >
                        Edit Part
                      </Button>
                      <Button
                        variant="outline"
                        className="border-status-danger-border px-3 text-status-danger hover:bg-status-danger-surface hover:text-status-danger"
                        aria-label={`Delete part ${part.name}`}
                        onClick={() => onDeletePart(part.id)}
                      >
                        Delete
                      </Button>
                    </MobileRecordActions>
                  </MobileRecordCard>
                );
              })}
            </MobileRecordList>
          ) : (
            <div data-desktop-record-results>
              <div className="overflow-x-auto text-xs 2xl:hidden">
                <div className="data-grid grid min-w-[520px] gap-px bg-surface-selected md:min-w-0">
                  <div className="data-grid-header grid grid-cols-[minmax(0,1.35fr)_108px_110px_112px] gap-px bg-surface-selected font-semibold uppercase tracking-[0.12em] text-muted-foreground [&>*]:bg-surface-raised">
                    <span>Part</span>
                    <span className="text-right">Stock</span>
                    <span className="text-right">Value</span>
                    <span className="text-right">Action</span>
                  </div>

                  {filteredParts.map((part) => {
                  const status = getInventoryStockStatus(part);
                  const stockValue = part.quantity * part.unitCost;

                  return (
                    <div
                      key={part.id}
                      className="data-grid-row grid grid-cols-[minmax(0,1.35fr)_108px_110px_112px] gap-px bg-surface-selected transition [&>*]:bg-card"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{part.name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{part.sku || "No SKU"} - {part.category}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{part.supplier || "No supplier"} / {part.location || "No location"}</p>
                      </div>
                      <div className="min-w-0 text-right text-text-secondary">
                        <p className="font-semibold text-foreground">{part.quantity}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Reorder {part.reorderLevel}</p>
                        <Badge className={`${status.className} mt-1 px-1.5 py-0 text-[10px]`}>{status.label}</Badge>
                      </div>
                      <div className="min-w-0 text-right text-text-secondary">
                        <p className="font-semibold text-foreground">{money(stockValue)}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{money(part.unitCost)} ea</p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-md border-border px-2 text-[11px]"
                          onClick={() => {
                            setEditingPart(part);
                            setPartDialogOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-md border-status-danger-border px-2 text-[11px] text-status-danger hover:bg-status-danger-surface hover:text-status-danger"
                          onClick={() => onDeletePart(part.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>
              <div className="hidden overflow-x-auto 2xl:block">
              <div className="min-w-[1320px]">
                <div className="data-grid grid gap-px bg-surface-selected">
                  <div className="data-grid-header grid grid-cols-[1.7fr_130px_150px_95px_110px_110px_120px_1fr_1fr_130px_150px] gap-px bg-surface-selected text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground [&>*]:bg-surface-raised">
                    <span>Part</span>
                    <span>SKU</span>
                    <span>Category</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Reorder</span>
                    <span className="text-right">Unit Cost</span>
                    <span className="text-right">Value</span>
                    <span>Supplier</span>
                    <span>Location</span>
                    <span>Status</span>
                    <span className="text-right">Action</span>
                  </div>

                  {filteredParts.map((part) => {
                  const status = getInventoryStockStatus(part);
                  const stockValue = part.quantity * part.unitCost;

                  return (
                    <div
                      key={part.id}
                      className="data-grid-row grid grid-cols-[1.7fr_130px_150px_95px_110px_110px_120px_1fr_1fr_130px_150px] gap-px bg-surface-selected text-sm transition [&>*]:bg-card"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{part.name}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{part.notes || "No notes saved"}</p>
                      </div>
                      <p className="truncate text-text-secondary">{part.sku || "Not set"}</p>
                      <p className="truncate text-text-secondary">{part.category}</p>
                      <p className="text-right font-medium text-foreground">{part.quantity}</p>
                      <p className="text-right text-text-secondary">{part.reorderLevel}</p>
                      <p className="text-right text-text-secondary">{money(part.unitCost)}</p>
                      <p className="text-right font-medium text-foreground">{money(stockValue)}</p>
                      <p className="truncate text-text-secondary">{part.supplier || "Not set"}</p>
                      <p className="truncate text-text-secondary">{part.location || "Not set"}</p>
                      <div>
                        <Badge className={status.className}>{status.label}</Badge>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-md border-border"
                          onClick={() => {
                            setEditingPart(part);
                            setPartDialogOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-md border-status-danger-border text-status-danger hover:bg-status-danger-surface hover:text-status-danger"
                          onClick={() => onDeletePart(part.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                  })}
                </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
        </Card>
      </div>

      <MobileFilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        returnFocusRef={filterTriggerRef}
        activeCount={activeFilterCount}
        description="Filter parts by their current stock level."
        onReset={() => setFilterBy("all")}
      >
        <FilterSheetField id="mobile-inventory-stock-filter" label="Stock filter">
          <Select value={filterBy} onValueChange={setFilterBy}>
            <SelectTrigger id="mobile-inventory-stock-filter" className="h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All parts</SelectItem>
              <SelectItem value="low-stock">Needs reorder</SelectItem>
              <SelectItem value="out-of-stock">Out of stock</SelectItem>
              <SelectItem value="in-stock">In stock</SelectItem>
            </SelectContent>
          </Select>
        </FilterSheetField>
      </MobileFilterSheet>

      <InventoryItemDialog
        open={partDialogOpen}
        onOpenChange={setPartDialogOpen}
        initialPart={editingPart}
        onSave={(partInput) => {
          if (editingPart) {
            return onUpdatePart(editingPart.id, partInput);
          }

          return onCreatePart(partInput);
        }}
      />
    </>
  );
}
