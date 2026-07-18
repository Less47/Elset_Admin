import crypto from "crypto";
import {
  decimalToScaledInteger,
  moneyToCents,
} from "./server-workspace-importer.js";
import { WORKSPACE_SCHEMA_VERSION } from "./server-workspace-db.js";
import { loadWorkspaceStateFromDb } from "./server-workspace-state.js";

const QUANTITY_SCALE = 1_000_000;
const inventoryCategories = new Set(["Automation", "Access Control", "Electrical", "Hardware", "Consumables", "Tools", "Other"]);
const inventoryKnownKeys = new Set([
  "id",
  "name",
  "sku",
  "category",
  "supplier",
  "location",
  "quantity",
  "reorderLevel",
  "unitCost",
  "notes",
  "createdAt",
  "updatedAt",
]);

export class WorkspaceInventoryError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "WorkspaceInventoryError";
    this.statusCode = statusCode;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "");
}

function trimText(value) {
  return text(value).trim();
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function objectJson(value) {
  return json(value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function assertPlainObject(value, label = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceInventoryError(`${label} must be an object.`);
  }
}

function normalizeId(value, label = "ID") {
  const id = trimText(value);
  if (!id) throw new WorkspaceInventoryError(`${label} is required.`);
  if (id.length > 180) throw new WorkspaceInventoryError(`${label} is too long.`);
  return id;
}

function normalizeOptionalId(value, label = "ID") {
  const id = trimText(value);
  if (!id) return "";
  if (id.length > 180) throw new WorkspaceInventoryError(`${label} is too long.`);
  return id;
}

function pickExtra(record, knownKeys) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return {};
  const extra = {};
  for (const [key, value] of Object.entries(record)) {
    if (!knownKeys.has(key)) extra[key] = value;
  }
  return extra;
}

function isDecimalInput(value) {
  if (typeof value === "number") return Number.isFinite(value);
  return /^\d+(?:\.\d+)?$/.test(trimText(value));
}

function normalizeDecimalText(value, label, { fallback = "0" } = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (!isDecimalInput(value)) throw new WorkspaceInventoryError(`${label} must be a valid number.`);
  return typeof value === "number" ? String(value) : trimText(value);
}

function quantityToMicros(value, label) {
  const normalized = normalizeDecimalText(value, label);
  let micros = 0;
  try {
    micros = decimalToScaledInteger(normalized, QUANTITY_SCALE);
  } catch (error) {
    throw new WorkspaceInventoryError(error instanceof Error ? error.message : `${label} is invalid.`);
  }
  if (micros < 0) throw new WorkspaceInventoryError(`${label} cannot be negative.`);
  return {
    text: normalized,
    micros,
  };
}

function moneyToSafeCents(value, label) {
  const normalized = normalizeDecimalText(value, label);
  let cents = 0;
  try {
    cents = moneyToCents(normalized);
  } catch (error) {
    throw new WorkspaceInventoryError(error instanceof Error ? error.message : `${label} is invalid.`);
  }
  if (cents < 0) throw new WorkspaceInventoryError(`${label} cannot be negative.`);
  return cents;
}

function centsToMoney(cents) {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function normalizeCategory(value) {
  const category = trimText(value);
  return inventoryCategories.has(category) ? category : "Other";
}

function normalizeInventoryInput(input, existing = null) {
  assertPlainObject(input, "Inventory item");
  const source = {
    ...(existing || {}),
    ...input,
  };
  const now = nowIso();
  const id = normalizeOptionalId(source.id || existing?.id, "Inventory item ID") || crypto.randomUUID();
  const name = trimText(source.name);
  if (!name) throw new WorkspaceInventoryError("Part name is required.");

  const quantity = quantityToMicros(source.quantity ?? 0, "Quantity");
  const reorderLevel = quantityToMicros(source.reorderLevel ?? 0, "Reorder level");
  const extra = pickExtra(source, inventoryKnownKeys);
  if (Object.prototype.hasOwnProperty.call(source, "salePrice")) {
    extra.salePrice = centsToMoney(moneyToSafeCents(source.salePrice, "Sale price"));
  }
  if (Object.prototype.hasOwnProperty.call(source, "price")) {
    extra.price = centsToMoney(moneyToSafeCents(source.price, "Sale price"));
  }
  if (Object.prototype.hasOwnProperty.call(source, "description")) {
    extra.description = trimText(source.description);
  }
  if (Object.prototype.hasOwnProperty.call(source, "partNumber")) {
    extra.partNumber = trimText(source.partNumber);
  }
  if (Object.prototype.hasOwnProperty.call(source, "active")) {
    extra.active = Boolean(source.active);
  }
  if (Object.prototype.hasOwnProperty.call(source, "archived")) {
    extra.archived = Boolean(source.archived);
  }

  return {
    id,
    name,
    sku: trimText(source.sku),
    category: normalizeCategory(source.category),
    supplier: trimText(source.supplier),
    location: trimText(source.location),
    quantityText: quantity.text,
    quantityMicros: quantity.micros,
    reorderLevelText: reorderLevel.text,
    reorderLevelMicros: reorderLevel.micros,
    unitCostCents: moneyToSafeCents(source.unitCost ?? 0, "Unit cost"),
    notes: trimText(source.notes),
    createdAt: trimText(existing?.createdAt || source.createdAt) || now,
    updatedAt: now,
    extra,
  };
}

function touchWorkspaceInfo(db, updatedAt = nowIso()) {
  db.prepare(`
    INSERT INTO workspace_info (id, schema_version, created_at, updated_at, meta_json)
    VALUES (1, ?, ?, ?, '{}')
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `).run(WORKSPACE_SCHEMA_VERSION, updatedAt, updatedAt);
}

function runForeignKeyCheck(db) {
  const errors = db.prepare("PRAGMA foreign_key_check").all();
  if (errors.length > 0) {
    throw new WorkspaceInventoryError(`Workspace relationship validation failed: ${JSON.stringify(errors)}`, 500);
  }
}

function getInventoryItemState(db, itemId) {
  return loadWorkspaceStateFromDb(db).inventoryItems.find((item) => item.id === itemId) || null;
}

function ensureInventoryItemExists(db, itemId) {
  const row = db.prepare("SELECT id FROM inventory_items WHERE id = ?").get(itemId);
  if (!row) throw new WorkspaceInventoryError("Inventory item not found.", 404);
}

function insertOrReplaceInventoryItem(db, item) {
  db.prepare(`
    INSERT INTO inventory_items (
      id, name, sku, category, supplier, location, quantity_text, quantity_micros, reorder_level_text,
      reorder_level_micros, unit_cost_cents, notes, created_at, updated_at, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      sku = excluded.sku,
      category = excluded.category,
      supplier = excluded.supplier,
      location = excluded.location,
      quantity_text = excluded.quantity_text,
      quantity_micros = excluded.quantity_micros,
      reorder_level_text = excluded.reorder_level_text,
      reorder_level_micros = excluded.reorder_level_micros,
      unit_cost_cents = excluded.unit_cost_cents,
      notes = excluded.notes,
      updated_at = excluded.updated_at,
      extra_json = excluded.extra_json
  `).run(
    item.id,
    item.name,
    item.sku,
    item.category,
    item.supplier,
    item.location,
    item.quantityText,
    item.quantityMicros,
    item.reorderLevelText,
    item.reorderLevelMicros,
    item.unitCostCents,
    item.notes,
    item.createdAt,
    item.updatedAt,
    objectJson(item.extra)
  );
}

export function createInventoryItem(db, input) {
  const item = normalizeInventoryInput(input);

  return db.transaction(() => {
    if (db.prepare("SELECT id FROM inventory_items WHERE id = ?").get(item.id)) {
      throw new WorkspaceInventoryError("An inventory item with that ID already exists.", 409);
    }
    insertOrReplaceInventoryItem(db, item);
    touchWorkspaceInfo(db, item.updatedAt);
    runForeignKeyCheck(db);
    return getInventoryItemState(db, item.id);
  })();
}

export function updateInventoryItem(db, itemIdInput, input) {
  assertPlainObject(input, "Inventory item");
  const itemId = normalizeId(itemIdInput, "Inventory item ID");

  return db.transaction(() => {
    const existing = getInventoryItemState(db, itemId);
    if (!existing) throw new WorkspaceInventoryError("Inventory item not found.", 404);
    const item = normalizeInventoryInput({ ...input, id: itemId }, existing);
    insertOrReplaceInventoryItem(db, item);
    touchWorkspaceInfo(db, item.updatedAt);
    runForeignKeyCheck(db);
    return getInventoryItemState(db, item.id);
  })();
}

export function deleteInventoryItem(db, itemIdInput) {
  const itemId = normalizeId(itemIdInput, "Inventory item ID");

  return db.transaction(() => {
    ensureInventoryItemExists(db, itemId);
    const item = getInventoryItemState(db, itemId);
    const deletedAt = nowIso();
    db.prepare(`
      INSERT INTO deleted_inventory_items (id, item_id, deleted_at, payload_json, extra_json)
      VALUES (?, ?, ?, ?, '{}')
    `).run(`deleted-inventory-item:${itemId}`, itemId, deletedAt, json(item));
    db.prepare("DELETE FROM inventory_items WHERE id = ?").run(itemId);
    touchWorkspaceInfo(db, deletedAt);
    runForeignKeyCheck(db);
    return {
      itemId,
      deletedAt,
    };
  })();
}

export function restoreDeletedInventoryItem(db, itemIdInput) {
  const itemId = normalizeId(itemIdInput, "Inventory item ID");

  return db.transaction(() => {
    if (db.prepare("SELECT id FROM inventory_items WHERE id = ?").get(itemId)) {
      throw new WorkspaceInventoryError("Inventory item already exists.", 409);
    }
    const row = db.prepare(`
      SELECT *
        FROM deleted_inventory_items
       WHERE item_id = ?
       LIMIT 1
    `).get(itemId);
    if (!row) throw new WorkspaceInventoryError("Deleted inventory item not found.", 404);

    const payload = parseJson(row.payload_json, null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new WorkspaceInventoryError("Deleted inventory item payload is invalid.", 500);
    }

    const item = normalizeInventoryInput({ ...payload, id: itemId });
    insertOrReplaceInventoryItem(db, item);
    db.prepare("DELETE FROM deleted_inventory_items WHERE id = ?").run(row.id);
    touchWorkspaceInfo(db, item.updatedAt);
    runForeignKeyCheck(db);
    return getInventoryItemState(db, item.id);
  })();
}
