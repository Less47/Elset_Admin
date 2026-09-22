import express from "express";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getWorkspaceStorageMode } from "./server-workspace-storage.js";
import { loadData, saveData } from "./server-store.js";
import { filterPriceList } from "./src/lib/price-list.js";
import { PriceListError, buildPriceListItem, createPriceListItem, getPriceListItem, listPriceListItems, updatePriceListItem } from "./server-workspace-price-list.js";

export function createPriceListRouter({ requireAuth, requireRole, env = process.env, jsonStore = { loadData, saveData } } = {}) {
  const router = express.Router();
  const auth = requireAuth || ((_req, res) => res.status(401).json({ error: "Authentication required." }));
  const manage = requireRole ? requireRole(["admin", "office"]) : ((_req, res) => res.status(403).json({ error: "Business settings permission required." }));
  router.use("/api/price-list-items", auth, manage);
  function handle(operation) {
    return (req, res) => {
      let db;
      res.set("Cache-Control", "no-store");
      try {
        if (getWorkspaceStorageMode(env) === "sqlite") db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), migrate: false });
        return res.json(operation(req, db));
      } catch (error) {
        return res.status(error instanceof PriceListError ? error.statusCode : 500).json({ error: error instanceof PriceListError ? error.message : "Unable to access the price list. Please try again." });
      } finally { db?.close(); }
    };
  }
  router.get("/api/price-list-items", handle((req, db) => {
    const { status = "active", search = "" } = req.query;
    if (!["active", "archived", "all"].includes(status) || typeof search !== "string" || search.length > 2000) throw new PriceListError("Invalid price-list filter.");
    const items = db ? listPriceListItems(db, { status, search }) : filterPriceList(jsonStore.loadData().priceListItems || [], search, status).sort((a, b) => a.name.localeCompare(b.name));
    return { items };
  }));
  router.get("/api/price-list-items/:id", handle((req, db) => {
    const item = db ? getPriceListItem(db, req.params.id) : (jsonStore.loadData().priceListItems || []).find((entry) => entry.id === req.params.id);
    if (!item) throw new PriceListError("Price-list item not found.", 404);
    return { item };
  }));
  function mutate(req, db, edit) {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new PriceListError("An item is required.");
    if (db) return { item: edit ? updatePriceListItem(db, req.params.id, req.body) : createPriceListItem(db, req.body) };
    // Legacy JSON workspaces keep this server-owned field through broad autosaves.
    const data = jsonStore.loadData();
    const items = data.priceListItems || [];
    const existing = edit ? items.find((item) => item.id === req.params.id) : null;
    if (edit && !existing) throw new PriceListError("Price-list item not found.", 404);
    const item = buildPriceListItem(req.body, existing);
    jsonStore.saveData({ ...data, priceListItems: edit ? items.map((entry) => entry.id === item.id ? item : entry) : [...items, item] });
    return { item };
  }
  router.post("/api/price-list-items", handle((req, db) => mutate(req, db, false)));
  router.patch("/api/price-list-items/:id", handle((req, db) => mutate(req, db, true)));
  return router;
}
