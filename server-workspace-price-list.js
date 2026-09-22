import crypto from "node:crypto";
import { priceListUnits, filterPriceList } from "./src/lib/price-list.js";

export class PriceListError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

function text(value, label, max, required = false) {
  if (value !== undefined && typeof value !== "string") throw new PriceListError(`${label} must be text.`);
  const result = (value || "").trim();
  if (required && !result) throw new PriceListError(`${label} is required.`);
  if (result.length > max) throw new PriceListError(`${label} is too long (maximum ${max} characters).`);
  return result;
}

export function normalizePriceListInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PriceListError("An item is required.");
  const unit = input.unit ?? "each";
  if (!priceListUnits.includes(unit)) throw new PriceListError("Choose a supported unit.");
  const taxTreatment = input.taxTreatment ?? "taxable";
  if (taxTreatment !== "taxable") throw new PriceListError("Only the existing 10% GST treatment is supported.");
  const price = input.unitPrice;
  if (!["number", "string"].includes(typeof price) || !/^\d+(?:\.\d{1,2})?$/.test(String(price).trim())
    || !Number.isSafeInteger(Math.round(Number(price) * 100)) || Number(price) > 999999999.99) {
    throw new PriceListError("Unit price must be a non-negative amount with at most two decimal places (maximum $999,999,999.99).");
  }
  if (input.archived !== undefined && typeof input.archived !== "boolean") throw new PriceListError("Archived must be true or false.");
  return {
    name: text(input.name, "Name", 200, true), description: text(input.description, "Description", 2000),
    code: text(input.code, "Item code", 100), category: text(input.category, "Category", 100),
    unit, unitPrice: Math.round(Number(price) * 100) / 100, taxTreatment, archived: input.archived === true,
  };
}

function mapItem(row) {
  return { id: row.id, name: row.name, description: row.description, code: row.code, unit: row.unit,
    unitPrice: row.unit_price_cents / 100, taxTreatment: row.tax_treatment, category: row.category,
    archived: Boolean(row.archived), createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listPriceListItems(db, { search = "", status = "active" } = {}) {
  return filterPriceList(db.prepare("SELECT * FROM price_list_items ORDER BY name COLLATE NOCASE, id").all().map(mapItem), search, status);
}

export function getPriceListItem(db, id) {
  const row = db.prepare("SELECT * FROM price_list_items WHERE id = ?").get(id);
  if (!row) throw new PriceListError("Price-list item not found.", 404);
  return mapItem(row);
}

export function buildPriceListItem(input, existing = null) {
  if (existing && input?.updatedAt !== existing.updatedAt) throw new PriceListError("This item changed since you opened it. Reload the list and try again.", 409);
  const values = normalizePriceListInput(existing ? { ...existing, ...input } : input);
  const now = new Date(Math.max(Date.now(), existing ? Date.parse(existing.updatedAt) + 1 : 0)).toISOString();
  return { ...values, id: existing?.id || crypto.randomUUID(), createdAt: existing?.createdAt || now, updatedAt: now };
}

// Used by the JSON importer as well as item mutations; no document rows change.
export function insertPriceListItem(db, item) {
  db.prepare(`INSERT INTO price_list_items
    (id,name,description,code,unit,unit_price_cents,tax_treatment,category,archived,created_at,updated_at)
    VALUES (@id,@name,@description,@code,@unit,@cents,@taxTreatment,@category,@archived,@createdAt,@updatedAt)`)
    .run({ ...item, cents: Math.round(item.unitPrice * 100), archived: Number(item.archived) });
}

export function createPriceListItem(db, input) {
  return db.transaction(() => {
    const item = buildPriceListItem(input);
    insertPriceListItem(db, item);
    db.prepare("UPDATE workspace_info SET updated_at=? WHERE id=1").run(item.updatedAt);
    return item;
  }).immediate();
}

export function updatePriceListItem(db, id, input) {
  return db.transaction(() => {
    const item = buildPriceListItem(input, getPriceListItem(db, id));
    db.prepare(`UPDATE price_list_items SET name=@name, description=@description, code=@code, unit=@unit,
      unit_price_cents=@cents, tax_treatment=@taxTreatment, category=@category, archived=@archived, updated_at=@updatedAt WHERE id=@id`)
      .run({ ...item, cents: Math.round(item.unitPrice * 100), archived: Number(item.archived) });
    db.prepare("UPDATE workspace_info SET updated_at=? WHERE id=1").run(item.updatedAt);
    return item;
  }).immediate();
}
