import { AccountingError } from "./server-accounting-errors.js";
import { AccountingStore } from "./server-accounting-store.js";
import { getWorkspaceAddons, requireWorkspaceAddon } from "./server-workspace-addons.js";

const entity = "price-list-item";
const fallbackCodes = new Set(["ITEM_NAME_CONFLICT", "ITEM_NAME_INVALID", "ACCOUNT_MAPPING", "ITEM_MAPPING", "MAPPING_CONFLICT", "PRICE_ITEM_UNAVAILABLE"]);

// IDs live in the provider/tenant-scoped mapping table, never in document snapshots.
export async function resolveQuickBooksLineItems(service, context, source, config, accounts) {
  const lineItemIds = Object.create(null), resolved = new Map();
  for (const line of source.lines) {
    if (!line.priceListItemId) continue;
    const id = line.priceListItemId;
    if (resolved.has(id)) { lineItemIds[line.id] = resolved.get(id); continue; }
    let externalId = config.itemId;
    try {
      const mapped = service.store.mapping(context.tenantId, entity, id);
      let item;
      if (mapped) {
        const row = (await service.provider.request(context, `item/${encodeURIComponent(mapped.external_entity_id)}`))?.Item;
        item = row && service.provider.salesItem(row, accounts);
        if (!item || item.id !== mapped.external_entity_id) throw new AccountingError("ITEM_MAPPING", "The mapped QuickBooks item is unavailable or ineligible. The fallback sales item was used.", 409);
      } else {
        const catalog = service.db.prepare("SELECT name,archived,updated_at FROM price_list_items WHERE id=?").get(id);
        if (!catalog || catalog.archived) throw new AccountingError("PRICE_ITEM_UNAVAILABLE", "The source price-list item is missing or archived. The fallback sales item was used.", 409);
        const result = await service.provider.ensureNamedSalesItem(context, catalog.name, config.incomeAccountId, accounts, async (payload, write) => {
          requireWorkspaceAddon(service.db, service.provider.id);
          const latest = service.db.prepare("SELECT name,archived,updated_at FROM price_list_items WHERE id=?").get(id);
          if (!latest || latest.archived || latest.updated_at !== catalog.updated_at) throw new AccountingError("PRICE_ITEM_UNAVAILABLE", "The price-list item changed during sync. The fallback sales item was used.", 409);
          const key = service.store.prepareOperation(context.tenantId, entity, id, payload);
          try { return await write(key); }
          catch (error) { if (error.code === "PROVIDER_VALIDATION") service.store.finishOperation(context.tenantId, entity, id, "REJECTED"); throw error; }
        });
        item = result.item;
        // The provider validated identity/type/account before any mapping is stored.
        service.store.map(context.tenantId, entity, id, item.id, item.fullyQualifiedName);
        service.store.finishOperation(context.tenantId, entity, id);
      }
      externalId = item.id;
      service.store.log(context.tenantId, entity, id, "resolve", "SYNCED", item.id);
    } catch (error) {
      if (!fallbackCodes.has(error.code)) throw error;
      service.store.log(context.tenantId, entity, id, "fallback", "FALLBACK", config.itemId, error);
    }
    resolved.set(id, externalId); lineItemIds[line.id] = externalId;
  }
  return { ...config, lineItemIds };
}

// Read-only metadata for the catalog UI. No provider calls, secrets or requirement
// to enable accounting just to use the price list. Old-company mappings stay stored.
export function withPriceListAccountingMappings(db, items) {
  if (!getWorkspaceAddons(db).quickbooks) return items;
  const store = new AccountingStore(db, "quickbooks");
  const connection = db.prepare("SELECT external_tenant_id,status,json_extract(credential_metadata_json,'$.pendingCompanySwitch.expiresAt') pending_until FROM workspace_integrations WHERE workspace_id=? AND provider='quickbooks'").get(store.workspaceId);
  if (connection?.status !== "CONNECTED" || connection.pending_until > Date.now()) return items;
  return items.map(item => {
    const mapped = store.mapping(connection.external_tenant_id, entity, item.id), latest = store.latest(connection.external_tenant_id, entity, item.id);
    return { ...item, accountingMappings: [{ provider: "quickbooks", tenantId: connection.external_tenant_id,
      externalId: mapped?.external_entity_id || "", name: mapped?.external_reference || "",
      status: latest?.status === "FALLBACK" ? "FALLBACK" : mapped ? "MAPPED" : "UNMAPPED",
      message: latest?.status === "FALLBACK" ? latest.safe_error_message : "" }] };
  });
}
