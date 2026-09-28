import express from "express";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { withPriceListAccountingMappings } from "./server-accounting-price-list.js";
import { PriceListError, createPriceListItem, getPriceListItem, listPriceListItems, updatePriceListItem } from "./server-workspace-price-list.js";

export function createPriceListRouter({ requireAuth, requireRole, env = process.env } = {}) {
  const router = express.Router();
  const auth = requireAuth || ((_req, res) => res.status(401).json({ error: "Authentication required." }));
  const manage = requireRole ? requireRole(["admin", "office"]) : ((_req, res) => res.status(403).json({ error: "Business settings permission required." }));
  router.use("/api/price-list-items", auth, manage);
  function handle(operation) {
    return (req, res) => {
      let db;
      res.set("Cache-Control", "no-store");
      try {
        db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env), migrate: false, fileMustExist: true });
        return res.json(operation(req, db));
      } catch (error) {
        return res.status(error instanceof PriceListError ? error.statusCode : 500).json({ error: error instanceof PriceListError ? error.message : "Unable to access the price list. Please try again." });
      } finally { db?.close(); }
    };
  }
  router.get("/api/price-list-items", handle((req, db) => {
    const { status = "active", search = "" } = req.query;
    if (!["active", "archived", "all"].includes(status) || typeof search !== "string" || search.length > 2000) throw new PriceListError("Invalid price-list filter.");
    const items = listPriceListItems(db, { status, search });
    return { items: withPriceListAccountingMappings(db, items) };
  }));
  router.get("/api/price-list-items/:id", handle((req, db) => {
    const item = getPriceListItem(db, req.params.id);
    if (!item) throw new PriceListError("Price-list item not found.", 404);
    return { item: withPriceListAccountingMappings(db, [item])[0] };
  }));
  function mutate(req, db, edit) {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new PriceListError("An item is required.");
    return { item: edit ? updatePriceListItem(db, req.params.id, req.body) : createPriceListItem(db, req.body) };
  }

  router.post("/api/price-list-items", handle((req, db) => mutate(req, db, false)));
  router.patch("/api/price-list-items/:id", handle((req, db) => mutate(req, db, true)));
  return router;
}
