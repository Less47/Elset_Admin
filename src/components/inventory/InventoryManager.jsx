import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { FormField } from "@/components/shared/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
            onClick={() => {
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
  const [partDialogOpen, setPartDialogOpen] = useState(false);
  const [editingPart, setEditingPart] = useState(null);
  const deferredSearch = useDeferredValue(search);

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

  return (
    <>
      <Card className="overflow-hidden rounded-xl border-slate-300 shadow-none">
        <CardHeader className="space-y-4 border-b border-slate-200 bg-slate-50 px-5 py-5">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <CardTitle className="text-lg">Parts Inventory</CardTitle>
              <p className="mt-1 text-sm text-slate-600">
                Keep your common parts, stock levels, suppliers, and reorder points in one place.
              </p>
            </div>
            <div className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center">
              <div>
                Showing <span className="font-semibold text-slate-900">{filteredParts.length}</span> of {inventoryStats.totalParts} parts
              </div>
              <Button
                className="rounded-lg"
                onClick={() => {
                  setEditingPart(null);
                  setPartDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> Add Part
              </Button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1.45fr)_220px_220px_auto]">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</p>
              <Input
                className="rounded-lg border-slate-300 bg-white"
                placeholder="Search part, SKU, supplier, or location..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Stock filter</p>
              <Select value={filterBy} onValueChange={setFilterBy}>
                <SelectTrigger className="rounded-lg border-slate-300 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All parts</SelectItem>
                  <SelectItem value="low-stock">Needs reorder</SelectItem>
                  <SelectItem value="out-of-stock">Out of stock</SelectItem>
                  <SelectItem value="in-stock">In stock</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Sort by</p>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="rounded-lg border-slate-300 bg-white">
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
            </div>

            <div className="flex items-end">
              <Button
                variant="outline"
                className="w-full rounded-lg border-slate-300 bg-white 2xl:w-auto"
                onClick={() => {
                  setSearch("");
                  setFilterBy("all");
                  setSortBy("name-asc");
                }}
              >
                Reset Filters
              </Button>
            </div>
          </div>
        </CardHeader>

        <div className="grid gap-px border-b border-slate-200 bg-slate-200 md:grid-cols-4">
          {[
            { label: "Parts", value: inventoryStats.totalParts },
            { label: "Units on hand", value: inventoryStats.totalUnits },
            { label: "Needs reorder", value: inventoryStats.lowStock + inventoryStats.outOfStock },
            { label: "Stock value", value: money(inventoryStats.inventoryValue) },
          ].map((stat) => (
            <div key={stat.label} className="bg-white px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{stat.label}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{stat.value}</p>
            </div>
          ))}
        </div>

        <CardContent className="p-0">
          {filteredParts.length === 0 ? (
            <div className="p-6">
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
          ) : (
            <>
              <div className="bg-white text-xs 2xl:hidden">
                <div className="grid grid-cols-[minmax(0,1.35fr)_108px_110px_112px] border-b border-slate-200 bg-slate-100 px-3 py-2 font-semibold uppercase tracking-[0.12em] text-slate-500">
                  <span>Part</span>
                  <span className="text-right">Stock</span>
                  <span className="text-right">Value</span>
                  <span className="text-right">Action</span>
                </div>

                {filteredParts.map((part, index) => {
                  const status = getInventoryStockStatus(part);
                  const stockValue = part.quantity * part.unitCost;

                  return (
                    <div
                      key={part.id}
                      className={`grid grid-cols-[minmax(0,1.35fr)_108px_110px_112px] items-center gap-2 px-3 py-2 transition hover:bg-slate-50 ${
                        index !== filteredParts.length - 1 ? "border-b border-slate-200" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-950">{part.name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{part.sku || "No SKU"} - {part.category}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{part.supplier || "No supplier"} / {part.location || "No location"}</p>
                      </div>
                      <div className="min-w-0 text-right text-slate-700">
                        <p className="font-semibold text-slate-950">{part.quantity}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">Reorder {part.reorderLevel}</p>
                        <Badge className={`${status.className} mt-1 px-1.5 py-0 text-[10px]`}>{status.label}</Badge>
                      </div>
                      <div className="min-w-0 text-right text-slate-700">
                        <p className="font-semibold text-slate-950">{money(stockValue)}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{money(part.unitCost)} ea</p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-md border-slate-300 px-2 text-[11px]"
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
                          className="h-7 rounded-md border-rose-200 px-2 text-[11px] text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                          onClick={() => onDeletePart(part.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto bg-white 2xl:block">
              <div className="min-w-[1320px]">
                <div className="grid grid-cols-[1.7fr_130px_150px_95px_110px_110px_120px_1fr_1fr_130px_150px] border-b border-slate-200 bg-slate-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
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

                {filteredParts.map((part, index) => {
                  const status = getInventoryStockStatus(part);
                  const stockValue = part.quantity * part.unitCost;

                  return (
                    <div
                      key={part.id}
                      className={`grid grid-cols-[1.7fr_130px_150px_95px_110px_110px_120px_1fr_1fr_130px_150px] items-center px-5 py-3 text-sm transition hover:bg-slate-50 ${
                        index !== filteredParts.length - 1 ? "border-b border-slate-200" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-950">{part.name}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{part.notes || "No notes saved"}</p>
                      </div>
                      <p className="truncate text-slate-700">{part.sku || "Not set"}</p>
                      <p className="truncate text-slate-700">{part.category}</p>
                      <p className="text-right font-medium text-slate-950">{part.quantity}</p>
                      <p className="text-right text-slate-700">{part.reorderLevel}</p>
                      <p className="text-right text-slate-700">{money(part.unitCost)}</p>
                      <p className="text-right font-medium text-slate-950">{money(stockValue)}</p>
                      <p className="truncate text-slate-700">{part.supplier || "Not set"}</p>
                      <p className="truncate text-slate-700">{part.location || "Not set"}</p>
                      <div>
                        <Badge className={status.className}>{status.label}</Badge>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-md border-slate-300"
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
                          className="rounded-md border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
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
            </>
          )}
        </CardContent>
      </Card>

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
