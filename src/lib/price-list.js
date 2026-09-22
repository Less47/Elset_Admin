export const priceListUnits = ["each", "hour", "day", "km", "metre", "fixed"];
export const priceListTaxLabel = "Taxable / 10% GST";

export function filterPriceList(items, search = "", status = "active") {
  const query = search.trim().toLowerCase();
  return items.filter((item) => (status === "all" || Boolean(item.archived) === (status === "archived"))
    && (!query || [item.name, item.code, item.description].some((value) => String(value || "").toLowerCase().includes(query))));
}

export function createBlankDocumentLine() {
  return { id: crypto.randomUUID(), description: "", qty: 1, rate: 0 };
}

// Copy primitives only. A document never resolves its price from the catalog.
export function priceListItemToLine(item) {
  if (!item || item.archived) throw new Error("This item is archived or unavailable. Choose an active item.");
  if (item.taxTreatment !== "taxable") throw new Error("This tax treatment is not supported by document calculations.");
  return { ...createBlankDocumentLine(), description: item.description || item.name, rate: item.unitPrice,
    unit: item.unit, taxTreatment: item.taxTreatment, priceListItemId: item.id };
}
