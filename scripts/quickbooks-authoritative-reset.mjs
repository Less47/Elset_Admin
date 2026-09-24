// TEMPORARY, explicit one-time reset. Never imported by application routes/workers.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AccountingService } from "../server-accounting-service.js";
import { assertWorkspaceSchema, getWorkspaceDbPath, openWorkspaceDb } from "../server-workspace-db.js";
import { readLocalHistory, fetchAll } from "./quickbooks-one-time-backfill.mjs";
import { normalized, normalizeInvoice, withoutSecrets, fingerprint, scaled } from "./quickbooks-reconciliation-core.mjs";
import { parseResetArgs, planReset, meaningfulMatch, invoiceUpdatePayload, paymentEvidence, isVoided, inRange, entityHash, sourceHash, reviewedInvoiceHash } from "./quickbooks-authoritative-reset-core.mjs";

const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const fail = (code, message = code) => { const error = new Error(message); error.code = code; throw error; };
const safeCode = error => /^[A-Z_]+$/.test(error?.code || "") ? error.code : "RESET_STOPPED";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const marker = (workspaceId, id, length = 24) => `ops-${sha(`${workspaceId}:${id}`).slice(0, length)}`;

// Only exact approved accounting resources/methods are reachable. Every POST
// needs a single-use capability for its exact payload. Sends and Payments have
// no capability type, even when apply is enabled.
export function resetTransport(fetchImpl, { mode, tenantId, paceMs = 250 }) {
  let pending = null, queue = Promise.resolve(), previous = 0;
  const audit = { quickbooksReads: 0, quickbooksMutations: 0, tokenRefreshes: 0, blockedRequests: 0, paymentMutations: 0, sendCalls: 0 };
  const transport = (input, options = {}) => {
    const task = queue.then(async () => {
      const url = new URL(input), method = (options.method || "GET").toUpperCase();
      const oauth = url.href === "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer" && method === "POST" && new URLSearchParams(options.body).get("grant_type") === "refresh_token";
      const prefix = `/v3/company/${tenantId}/`, endpoint = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
      const qbo = url.origin === "https://quickbooks.api.intuit.com" && Boolean(endpoint);
      const read = qbo && method === "GET" && /^(query|preferences|companyinfo\/\d+|invoice\/\d+|customer\/\d+|item\/\d+|payment\/\d+|creditmemo\/\d+|deposit\/\d+)$/.test(endpoint) && !url.searchParams.has("operation");
      const operation = url.searchParams.get("operation") || "write";
      const bodyHash = options.body ? sha(options.body) : "";
      const write = qbo && mode === "reset-apply" && method === "POST" && ["invoice", "customer", "item"].includes(endpoint)
        && (operation === "write" || endpoint === "invoice" && operation === "void") && pending?.endpoint === endpoint && pending?.operation === operation && pending?.bodyHash === bodyHash;
      if (!oauth && !read && !write) { audit.blockedRequests++; fail("BLOCKED_REQUEST", "Reset blocked an unapproved resource, write or send endpoint."); }
      if (write) pending = null;
      const wait = Math.max(0, paceMs - (Date.now() - previous));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      previous = Date.now();
      audit[oauth ? "tokenRefreshes" : read ? "quickbooksReads" : "quickbooksMutations"]++;
      return fetchImpl(input, options);
    });
    queue = task.catch(() => {}); return task;
  };
  transport.permit = (endpoint, payload, operation = "write") => {
    if (mode !== "reset-apply" || !["invoice", "customer", "item"].includes(endpoint) || !["write", "void"].includes(operation) || operation === "void" && endpoint !== "invoice") fail("BLOCKED_REQUEST");
    if (pending) fail("PENDING_WRITE_CAPABILITY");
    pending = { endpoint, operation, bodyHash: sha(JSON.stringify(payload)) };
  };
  transport.clear = () => { pending = null; };
  transport.audit = audit; return transport;
}

// Verify the actual mounted volume and completed snapshot through read-only Fly
// API calls. Operator supplies a short-lived app-scoped token only when applying.
export async function verifyFlySnapshot({ app, machineId, volumeId, snapshotId, token, approvedAt, now = Date.now(), fetchImpl = fetch }) {
  if (app !== "elset-admin" || !/^[a-f0-9]+$/.test(machineId || "") || !/^vol_[a-z0-9]+$/.test(volumeId || "") || !/^vs_[A-Za-z0-9]+$/.test(snapshotId || "") || !token) fail("SNAPSHOT_VERIFICATION_REQUIRED");
  const get = async endpoint => {
    const response = await fetchImpl(`https://api.machines.dev/v1/apps/${app}/${endpoint}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok) fail("SNAPSHOT_VERIFICATION_FAILED");
    return response.json();
  };
  const machine = await get(`machines/${machineId}`), volume = await get(`volumes/${volumeId}`), snapshots = await get(`volumes/${volumeId}/snapshots`);
  if (machine.id !== machineId || !machine.config?.mounts?.some(m => m.path === "/app/data" && m.volume === volumeId) || volume.id !== volumeId || volume.attached_machine_id !== machineId) fail("SNAPSHOT_WRONG_VOLUME");
  const snapshot = Array.isArray(snapshots) && snapshots.find(row => row.id === snapshotId), created = Date.parse(snapshot?.created_at);
  if (!snapshot || !Number.isFinite(created) || !Number.isFinite(Date.parse(approvedAt)) || created < Date.parse(approvedAt) || created > now || now - created > 60 * 60_000
    || !(snapshot.size > 0) || !snapshot.digest || snapshot.status && snapshot.status !== "created") fail("FRESH_COMPLETED_SNAPSHOT_REQUIRED");
  return { app, machineId, volumeId, snapshotId, createdAt: snapshot.created_at, verifiedAt: new Date(now).toISOString(), digest: snapshot.digest, size: snapshot.size };
}

function readLocalInput(db) {
  return db.transaction(() => {
    const localInvoices = readLocalHistory(db);
    for (const source of localInvoices) {
      const extras = new Map(db.prepare("SELECT id,extra_json FROM invoice_line_items WHERE invoice_id=?").all(source.id).map(row => [row.id, JSON.parse(row.extra_json || "{}")]));
      for (const line of source.lines) if (typeof extras.get(line.id)?.priceListItemId === "string" && extras.get(line.id).priceListItemId) line.priceListItemId = extras.get(line.id).priceListItemId;
    }
    const workspaceId = db.prepare("SELECT workspace_id FROM integration_workspace WHERE id=1").get().workspace_id;
    return { localInvoices, workspaceId, localCustomers: db.prepare("SELECT id,name,email FROM customers").all(),
      catalog: db.prepare("SELECT id,name,archived,updated_at FROM price_list_items").all(),
      mappings: db.prepare("SELECT provider,external_tenant_id,local_entity_type,local_entity_id,external_entity_id FROM integration_entity_mappings WHERE workspace_id=?").all(workspaceId) };
  })();
}

export function decisionHash(row) {
  return fingerprint({ sourceHash: row.sourceHash, previousMappingId: row.previousMappingId, canonicalId: row.canonicalId, customer: { id: row.customerResolution.id, safe: row.customerResolution.safe, state: row.customerResolution.state },
    actions: row.actions, updateFields: row.updateFields, duplicates: row.duplicateIds, reviews: row.reviews, itemPlan: row.itemPlan.map(item => ({ lineId: item.lineId, id: item.id, name: item.name, incomeAccountId: item.incomeAccountId })),
    candidates: row.candidates.map(candidate => ({ id: candidate.id, reviewedHash: candidate.reviewedHash, number: candidate.docNumber, date: candidate.date, sameCustomer: candidate.sameCustomer, sameAmounts: candidate.sameAmounts,
      sameLines: candidate.sameLines, payment: candidate.payment, owners: candidate.otherOwners, otherMapping: candidate.otherMapping })) });
}

function paymentEconomics(inventory) {
  return [...inventory.payments].sort((a, b) => a.Id.localeCompare(b.Id)).map(row => ({ Id: row.Id, SyncToken: row.SyncToken, CustomerRef: row.CustomerRef, TxnDate: row.TxnDate, TotalAmt: row.TotalAmt,
    UnappliedAmt: row.UnappliedAmt, CurrencyRef: row.CurrencyRef, DepositToAccountRef: row.DepositToAccountRef, PaymentMethodRef: row.PaymentMethodRef,
    Line: (row.Line || []).map(line => ({ Amount: line.Amount, LinkedTxn: line.LinkedTxn })) }));
}

export function createResetAdapter(service, transport, mode, auditEvent) {
  let context, config, options;
  const requireApply = () => { if (mode !== "reset-apply") fail("DRY_RUN_WRITE_BLOCKED"); };
  const adapter = {
    async load() {
      context = await service.credentials(); options = await service.options(context);
      let ready = true;
      try { config = service.validateConfig(JSON.parse(service.store.integration().config_json), options); }
      catch { ready = false; config = {}; }
      if (!["AU", "Australia"].includes(options.organisation.country) || options.organisation.currency !== "AUD") fail("COMPANY_MISMATCH");
      const inventory = {};
      for (const [key, entity] of [["invoices", "Invoice"], ["customers", "Customer"], ["items", "Item"], ["payments", "Payment"], ["credits", "CreditMemo"], ["deposits", "Deposit"]]) inventory[key] = await fetchAll(service, context, entity, ["Customer", "Item"].includes(entity) ? "Active IN (true,false)" : "");
      return { ...readLocalInput(service.db), inventory, config, configurationReady: ready, tenantId: context.tenantId, organisation: options.organisation };
    },
    async readInvoice(id) { return service.provider.getInvoice(context, id); },
    assertSource(source) {
      const current = readLocalInput(service.db).localInvoices.find(row => row.id === source.id);
      if (!current || sourceHash(current) !== sourceHash(source)) fail("LOCAL_EDIT_CONFLICT");
    },
    async write(endpoint, payload, operationId, operation = "write") {
      requireApply();
      const key = service.store.prepareOperation(context.tenantId, "authoritative-reset", operationId, { endpoint, operation, payload });
      transport.permit(endpoint, payload, operation);
      try { return await service.provider.request(context, `${endpoint}${operation === "void" ? "?operation=void" : ""}`, "POST", payload, key); }
      finally { transport.clear(); }
    },
    finish(operationId) { requireApply(); service.store.finishOperation(context.tenantId, "authoritative-reset", operationId); },
    async customer(source, resolution) {
      requireApply(); adapter.assertSource(source);
      let id = resolution.id;
      const reference = `ELSET:${marker(service.store.workspaceId, source.customerId, 40)}`;
      if (!id) {
        const customer = await service.provider.ensureCustomer(context, source.customer, reference.slice(6), async (payload) => adapter.write("customer", payload, `customer:${source.customerId}`));
        id = customer.id;
      }
      const raw = (await service.provider.request(context, `customer/${id}`))?.Customer;
      if (!raw || raw.Id !== id || raw.Active !== true || raw.Job || raw.IsProject || raw.ParentRef?.value || !resolution.id && raw.Notes !== reference) fail("CUSTOMER_READBACK_FAILED");
      adapter.assertSource(source);
      service.store.map(context.tenantId, "customer", source.customerId, id, raw.Notes || "");
      if (!resolution.id) adapter.finish(`customer:${source.customerId}`);
      auditEvent({ operation: "VERIFIED_CUSTOMER_MAPPING", localId: source.customerId, externalId: id }); return id;
    },
    async newInvoicePayload(source, customerId) {
      requireApply(); adapter.assertSource(source);
      const itemIds = {};
      for (const line of source.lines) {
        let id = config.itemId;
        if (line.priceListItemId) {
          const mapping = service.store.mapping(context.tenantId, "price-list-item", line.priceListItemId);
          const catalog = service.db.prepare("SELECT name,archived,updated_at FROM price_list_items WHERE id=?").get(line.priceListItemId);
          let raw;
          if (mapping) raw = (await service.provider.request(context, `item/${mapping.external_entity_id}`))?.Item;
          else if (catalog && !catalog.archived) {
            const items = await fetchAll(service, context, "Item", "Active IN (true,false)");
            const matches = items.filter(item => [item.Name, item.FullyQualifiedName].some(name => normalized(name) === normalized(catalog.name)));
            if (matches.length === 1) raw = matches[0];
            else if (!matches.length && catalog.name.trim() && catalog.name.length <= 100 && !catalog.name.includes(":") && ![...catalog.name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
              && options.accounts.some(account => account.id === config.incomeAccountId && account.type === "Income")) {
              const latest = service.db.prepare("SELECT name,archived,updated_at FROM price_list_items WHERE id=?").get(line.priceListItemId);
              if (JSON.stringify(latest) !== JSON.stringify(catalog)) fail("PRICE_LIST_EDIT_CONFLICT");
              const payload = { Name: catalog.name.trim(), Type: "Service", Active: true, IncomeAccountRef: { value: config.incomeAccountId } };
              const response = await adapter.write("item", payload, `item:${line.priceListItemId}`);
              if (!/^\d+$/.test(response?.Item?.Id || "")) fail("ITEM_READBACK_FAILED");
              raw = (await service.provider.request(context, `item/${response.Item.Id}`))?.Item;
              if (raw?.Type !== "Service" || raw.IncomeAccountRef?.value !== config.incomeAccountId || normalized(raw.Name) !== normalized(catalog.name)) fail("ITEM_READBACK_FAILED");
              adapter.finish(`item:${line.priceListItemId}`);
            }
          }
          if (raw) raw = (await service.provider.request(context, `item/${raw.Id}`))?.Item;
          const eligible = raw && service.provider.salesItem(raw, options.accounts);
          if (eligible && (!mapping || mapping.external_entity_id === eligible.id)) {
            try { service.store.map(context.tenantId, "price-list-item", line.priceListItemId, eligible.id, eligible.fullyQualifiedName); id = eligible.id; }
            catch (error) { if (error.code !== "MAPPING_CONFLICT") throw error; auditEvent({ operation: "ITEM_FALLBACK", lineId: line.id, reason: "MAPPING_CONFLICT" }); }
          } else auditEvent({ operation: "ITEM_FALLBACK", lineId: line.id, reason: "MISSING_ARCHIVED_AMBIGUOUS_OR_INELIGIBLE_SOURCE" });
        }
        const raw = (await service.provider.request(context, `item/${id}`))?.Item;
        if (!raw || !service.provider.salesItem(raw, options.accounts)) fail("ITEM_READBACK_FAILED");
        itemIds[line.id] = id;
      }
      adapter.assertSource(source);
      const payload = service.provider.invoicePayload(source, customerId, config, marker(service.store.workspaceId, source.id));
      payload.Line.forEach((line, index) => { line.SalesItemLineDetail.ItemRef = { value: itemIds[source.lines[index].id] }; });
      return payload;
    },
    mapInvoice(source, raw, customerId, previousId, { allowNumberDifference = false } = {}) {
      requireApply(); adapter.assertSource(source);
      const candidate = allowNumberDifference ? { ...raw, DocNumber: source.number } : raw;
      if (!meaningfulMatch(source, candidate, customerId)) fail("UNVERIFIED_MAPPING_BLOCKED");
      const result = service.provider.describeInvoice(raw);
      service.db.transaction(() => {
        const current = service.store.mapping(context.tenantId, "invoice", source.id);
        if ((current?.external_entity_id || "") !== previousId && current?.external_entity_id !== raw.Id) fail("MAPPING_EDIT_CONFLICT");
        const foreign = service.db.prepare("SELECT 1 FROM integration_entity_mappings WHERE local_entity_type='invoice' AND local_entity_id=? AND (provider!='quickbooks' OR external_tenant_id!=?)").get(source.id, context.tenantId);
        if (foreign) fail("OTHER_ACCOUNTING_OWNER");
        if (current && current.external_entity_id !== raw.Id) {
          const changed = service.db.prepare("UPDATE integration_entity_mappings SET external_entity_id=?,external_reference=?,external_fingerprint=?,external_version=?,updated_at=? WHERE workspace_id=? AND provider='quickbooks' AND external_tenant_id=? AND local_entity_type='invoice' AND local_entity_id=? AND external_entity_id=?")
            .run(raw.Id, result.number, result.fingerprint, result.version, new Date().toISOString(), service.store.workspaceId, context.tenantId, source.id, previousId);
          if (changed.changes !== 1) fail("MAPPING_EDIT_CONFLICT");
        } else service.store.map(context.tenantId, "invoice", source.id, raw.Id, result.number, result.fingerprint, result.version);
      })();
      auditEvent({ operation: previousId && previousId !== raw.Id ? "VERIFIED_REMAP" : "VERIFIED_INVOICE_MAPPING", localId: source.id, before: previousId, after: raw.Id });
    },
  };
  return adapter;
}

function financialAndLinkSignature(raw, inventory) {
  const n = normalizeInvoice(raw), payments = paymentEvidence(raw, inventory);
  return fingerprint({ customer: n.customerId, date: n.date, currency: n.currency, lines: n.lines, subtotal: n.subtotalCents, tax: n.taxCents, total: n.totalCents,
    balance: scaled(raw.Balance), due: raw.DueDate, deposit: raw.Deposit, links: payments.links, paymentEconomics: paymentEconomics(inventory).filter(row => payments.paymentIds.includes(row.Id)) });
}

// Injectable adapter keeps synthetic apply tests behind the same executor as
// production. Every mutation has an archive, fresh read, read-back and validation.
export async function applyReset(approved, { adapter, archive, event, snapshot }) {
  if (!snapshot?.snapshotId || !snapshot.verifiedAt || Date.now() - Date.parse(snapshot.verifiedAt) > 60_000) fail("SNAPSHOT_VERIFICATION_REQUIRED");
  const before = await adapter.load(), initial = planReset(before, approved.range), initialArchive = await archive({ stage: "before-apply", input: before, plan: initial, snapshot });
  if (!initialArchive) fail("ARCHIVE_REQUIRED");
  const outcomes = [];
  const createdCustomers = new Map(), resolvedItems = new Map();
  const recheck = async (source, targetId, predicate) => {
    adapter.assertSource(source);
    const input = await adapter.load(), raw = await adapter.readInvoice(targetId);
    if (!inRange(source.date, approved.range) || !inRange(raw.TxnDate, approved.range) || !/^\d+$/.test(String(raw.SyncToken ?? ""))) fail("TARGET_SCOPE_OR_VERSION_CHANGED");
    input.inventory.invoices = input.inventory.invoices.map(row => row.Id === raw.Id ? raw : row);
    if (!predicate(raw, input)) fail("LIVE_ACCOUNTING_STATE_CHANGED");
    if (!await archive({ stage: "immediately-before-mutation", source, invoice: raw, inventory: input.inventory })) fail("ARCHIVE_REQUIRED");
    adapter.assertSource(source);
    return { input, raw };
  };
  const verifiedWrite = async (operationId, payload, operation, verify) => {
    const response = await adapter.write("invoice", payload, operationId, operation);
    const id = payload.Id || response?.Invoice?.Id;
    if (!/^\d+$/.test(id || "")) fail("INVOICE_READBACK_FAILED");
    const after = await adapter.readInvoice(id), state = await adapter.load();
    if (after.Id !== id || entityHash(after) !== entityHash(state.inventory.invoices.find(row => row.Id === id)) || !verify(after, state)) fail("INVOICE_READBACK_FAILED");
    adapter.finish(operationId); event({ operation: operation === "void" ? "VOID_VERIFIED" : payload.Id ? "UPDATE_VERIFIED" : "CREATE_VERIFIED", id, syncToken: after.SyncToken });
    return after;
  };
  for (const original of approved.records) {
    try {
      const input = await adapter.load(), current = planReset(input, approved.range).records.find(row => row.elsetInvoiceId === original.elsetInvoiceId);
      const source = input.localInvoices.find(row => row.id === original.elsetInvoiceId);
      if (!source || !current || current.sourceHash !== original.sourceHash) fail("LOCAL_EDIT_CONFLICT");
      if (current.primaryAction === "KEEP_AS_IS" && !current.reviews.length && !current.duplicateIds.length && current.previousMappingId === current.canonicalId && current.actions.every(action => action === "KEEP_AS_IS")) { outcomes.push({ invoiceNumber: source.number, status: "ALREADY_ALIGNED" }); continue; }
      if (original.reviews.length) { outcomes.push({ invoiceNumber: source.number, status: "REVIEW_REQUIRED", reasons: original.reviews }); continue; }
      const approvedCurrent = structuredClone(original);
      if (original.customerResolution.state === "NEW" && createdCustomers.get(source.customerId) === current.customerResolution.id) approvedCurrent.customerResolution = current.customerResolution;
      for (const item of approvedCurrent.itemPlan) {
        const sourceLine = source.lines.find(line => line.id === item.lineId), actual = current.itemPlan.find(line => line.lineId === item.lineId);
        if (item.status === "WOULD_REQUIRE_NEW_ITEM" && sourceLine?.priceListItemId && resolvedItems.get(sourceLine.priceListItemId) === actual?.id) Object.assign(item, actual);
      }
      if (decisionHash(current) !== decisionHash(approvedCurrent)) fail("DRY_RUN_PLAN_CHANGED");
      adapter.assertSource(source);
      if (current.actions.includes("CREATE_QB")) {
        const customerId = await adapter.customer(source, current.customerResolution), payload = await adapter.newInvoicePayload(source, customerId);
        if (current.customerResolution.state === "NEW") createdCustomers.set(source.customerId, customerId);
        source.lines.forEach((line, index) => { if (line.priceListItemId) resolvedItems.set(line.priceListItemId, payload.Line[index].SalesItemLineDetail.ItemRef.value); });
        const latest = await adapter.load(), replan = planReset(latest, approved.range).records.find(row => row.elsetInvoiceId === source.id);
        if (!replan || replan.sourceHash !== current.sourceHash || !replan.actions.includes("CREATE_QB") || replan.reviews.length) fail("CREATE_IDENTITY_CHANGED");
        if (!await archive({ stage: "before-create", source, inventory: latest.inventory, payload })) fail("ARCHIVE_REQUIRED");
        adapter.assertSource(source);
        const created = await verifiedWrite(`create:${source.id}`, payload, "write", (raw, state) => meaningfulMatch(source, raw, customerId) && paymentEvidence(raw, state.inventory).unlinkedUnpaid);
        adapter.mapInvoice(source, created, customerId, current.previousMappingId);
        outcomes.push({ invoiceNumber: source.number, status: "CREATED", qbId: created.Id }); continue;
      }
      const canonical = current.candidates.find(candidate => candidate.id === current.canonicalId), customerId = current.customerResolution.id;
      // Resolve an existing paid canonical before touching an unlinked duplicate.
      // This mapping is verified on business content; number alignment follows.
      if (current.actions.includes("REMAP_TO_DIFFERENT_QB_RECORD") && canonical.fullMatch) {
        const { raw } = await recheck(source, canonical.id, (raw, state) => reviewedInvoiceHash(raw) === canonical.reviewedHash && meaningfulMatch(source, { ...raw, DocNumber: source.number }, customerId)
          && (!canonical.payment.legitimatePayments || paymentEvidence(raw, state.inventory).legitimatePayments));
        adapter.mapInvoice(source, raw, customerId, current.previousMappingId, { allowNumberDifference: true });
      }
      for (const duplicateId of current.duplicateIds) {
        const duplicate = current.candidates.find(candidate => candidate.id === duplicateId);
        let checked = await recheck(source, duplicateId, (raw, state) => {
          const canonicalNow = state.inventory.invoices.find(row => row.Id === canonical.id);
          return reviewedInvoiceHash(raw) === duplicate.reviewedHash && paymentEvidence(raw, state.inventory).unlinkedUnpaid && meaningfulMatch(source, { ...raw, DocNumber: source.number }, customerId)
            && canonicalNow && meaningfulMatch(source, { ...canonicalNow, DocNumber: source.number }, customerId)
            && (!canonical.payment.legitimatePayments || paymentEvidence(canonicalNow, state.inventory).legitimatePayments)
            && !state.mappings.some(m => m.provider === "quickbooks" && m.external_tenant_id === state.tenantId && m.local_entity_type === "invoice" && m.external_entity_id === duplicateId);
        });
        const releaseNumber = `VOID-${duplicateId}`;
        if (checked.raw.DocNumber === source.number) {
          if (releaseNumber.length > 21 || checked.input.inventory.invoices.some(raw => raw.Id !== duplicateId && raw.DocNumber === releaseNumber)) fail("DUPLICATE_REFERENCE_CONFLICT");
          const signature = financialAndLinkSignature(checked.raw, checked.input.inventory);
          await verifiedWrite(`release-number:${source.id}:${duplicateId}`, { Id: duplicateId, SyncToken: checked.raw.SyncToken, sparse: true, DocNumber: releaseNumber }, "write",
            (raw, state) => raw.DocNumber === releaseNumber && financialAndLinkSignature(raw, state.inventory) === signature);
          checked = await recheck(source, duplicateId, (raw, state) => raw.DocNumber === releaseNumber && paymentEvidence(raw, state.inventory).unlinkedUnpaid
            && financialAndLinkSignature(raw, state.inventory) === signature && !state.mappings.some(m => m.local_entity_type === "invoice" && m.external_entity_id === duplicateId && m.provider === "quickbooks" && m.external_tenant_id === state.tenantId));
        }
        await verifiedWrite(`void:${source.id}:${duplicateId}`, { Id: duplicateId, SyncToken: checked.raw.SyncToken }, "void",
          (raw, state) => scaled(raw.TotalAmt) === 0 && scaled(raw.Balance) === 0 && isVoided(raw) && !paymentEvidence(raw, state.inventory).links.length);
      }
      if (current.updateFields.length) {
        const checked = await recheck(source, canonical.id, (raw, state) => {
          if (reviewedInvoiceHash(raw) !== canonical.reviewedHash) return false;
          const evidence = paymentEvidence(raw, state.inventory);
          if (current.updateFields.some(field => field !== "DocNumber")) return evidence.unlinkedUnpaid;
          return evidence.unlinkedUnpaid || evidence.legitimatePayments && meaningfulMatch(source, { ...raw, DocNumber: source.number }, customerId);
        });
        const payload = invoiceUpdatePayload(source, checked.raw, customerId, checked.input.config, current.updateFields), signature = financialAndLinkSignature(checked.raw, checked.input.inventory);
        const external = await verifiedWrite(`update:${source.id}`, payload, "write", (raw, state) => meaningfulMatch(source, raw, customerId)
          && (current.updateFields.every(field => field === "DocNumber") ? financialAndLinkSignature(raw, state.inventory) === signature : paymentEvidence(raw, state.inventory).unlinkedUnpaid));
        adapter.mapInvoice(source, external, customerId, current.previousMappingId);
      } else {
        const raw = await adapter.readInvoice(canonical.id);
        if (!meaningfulMatch(source, raw, customerId)) fail("INVOICE_READBACK_FAILED");
        adapter.mapInvoice(source, raw, customerId, current.previousMappingId);
      }
      outcomes.push({ invoiceNumber: source.number, status: "ALIGNED", qbId: canonical.id, actions: current.actions });
    } catch (error) {
      const outcome = { invoiceNumber: original.invoiceNumber, status: "REVIEW_REQUIRED", reason: safeCode(error) }; outcomes.push(outcome); event(outcome);
      if (["NEEDS_REAUTHORIZATION", "RATE_LIMITED", "ARCHIVE_REQUIRED"].includes(error.code)) break;
    }
  }
  const after = await adapter.load(), comparison = planReset(after, approved.range), paymentsUnchanged = fingerprint(paymentEconomics(before.inventory)) === fingerprint(paymentEconomics(after.inventory));
  const exceptions = comparison.records.filter(row => row.reviews.length || row.actions.some(action => action !== "KEEP_AS_IS") || row.warnings.some(w => /DUPLICATE|PAYMENT/.test(w)))
    .map(row => ({ invoiceNumber: row.invoiceNumber, canonicalId: row.canonicalId, actionsRemaining: row.actions.filter(action => action !== "KEEP_AS_IS"), reasons: row.reviews, warnings: row.warnings }));
  if (!paymentsUnchanged) exceptions.push({ reason: "PAYMENT_HISTORY_CHANGED_DURING_RUN_REVIEW_REQUIRED" });
  for (const outcome of outcomes.filter(row => row.status === "REVIEW_REQUIRED")) if (!exceptions.some(row => row.invoiceNumber === outcome.invoiceNumber)) exceptions.push(outcome);
  for (const row of comparison.qbOnly.filter(row => row.reason !== "ALREADY_VOIDED")) exceptions.push({ qbId: row.qbId, docNumber: row.docNumber, reason: "QB_ONLY_OR_UNRESOLVED_LEAVE_REPORT", linkedTransactions: row.linkedTransactions });
  const outsideBefore = before.inventory.invoices.filter(raw => !inRange(raw.TxnDate, approved.range));
  const outsideUnchanged = outsideBefore.every(raw => entityHash(raw) === entityHash(after.inventory.invoices.find(row => row.Id === raw.Id)));
  if (!outsideUnchanged) exceptions.push({ reason: "OUTSIDE_RANGE_QB_CHANGE_OBSERVED_REVIEW_REQUIRED" });
  const aligned = comparison.records.every(row => row.canonicalId && !row.reviews.length && !row.actions.some(action => action !== "KEEP_AS_IS"));
  return { outcomes, postApplyComparison: comparison, verification: { paymentsUnchanged, outsideRangeUnchanged: outsideUnchanged, allInRangeElsetInvoicesAligned: aligned }, exceptions, finalArchive: await archive({ stage: "after-apply", inventory: after.inventory, comparison }) };
}

function csv(rows, columns) {
  const cell = value => {
    let text = value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [columns.join(","), ...rows.map(row => columns.map(key => cell(row[key])).join(","))].join("\r\n");
}
export function writeResetReports(report, directory, timestamp) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const base = path.join(directory, `quickbooks-authoritative-reset-${report.mode}-${timestamp}`);
  const output = { json: `${base}.json`, csv: `${base}.csv`, exceptions: `${base}-exceptions.json` };
  fs.writeFileSync(output.json, JSON.stringify(withoutSecrets(report), null, 2), { flag: "wx", mode: 0o600 });
  fs.writeFileSync(output.csv, csv(report.plan.records, ["invoiceNumber", "elsetInvoiceId", "customer", "date", "subtotalCents", "gstCents", "totalCents", "paidCents", "primaryAction", "actions", "previousMappingId", "canonicalId", "canonicalReason", "updateFields", "duplicateIds", "reviews", "warnings", "customerResolution", "candidates", "itemPlan"]), { flag: "wx", mode: 0o600 });
  fs.writeFileSync(output.exceptions, JSON.stringify(withoutSecrets(report.exceptions || report.plan.records.filter(row => row.reviews.length || row.warnings.length).map(row => ({ invoiceNumber: row.invoiceNumber, reviews: row.reviews, warnings: row.warnings }))), null, 2), { flag: "wx", mode: 0o600 });
  return { ...output, sha256: sha(fs.readFileSync(output.json)) };
}

export async function resetCli(args = process.argv.slice(2), { env = process.env, output = console.log, fetchImpl = fetch } = {}) {
  const parsed = parseResetArgs(args), dbPath = getWorkspaceDbPath(env);
  if (process.platform !== "linux" || env.FLY_APP_NAME !== "elset-admin" || !env.FLY_MACHINE_ID || dbPath !== "/app/data/elset-workspace.db" || fs.realpathSync(dbPath) !== dbPath || env.QUICKBOOKS_ENVIRONMENT !== "production") fail("FLY_PRODUCTION_ONLY", "Run inside elset-admin against its existing /app/data/elset-workspace.db. No local production copies.");
  const check = openWorkspaceDb({ dbPath, readonly: true, fileMustExist: true, migrate: false });
  let tenantId;
  try { assertWorkspaceSchema(check); const row = check.prepare("SELECT external_tenant_id,provider_environment FROM workspace_integrations WHERE provider='quickbooks'").get();
    if (row?.provider_environment !== "production" || !/^\d+$/.test(row.external_tenant_id)) fail("PRODUCTION_CONNECTION_REQUIRED"); tenantId = row.external_tenant_id;
  } finally { check.close(); }
  const directory = fileURLToPath(new URL("../output/", import.meta.url)), timestamp = stamp();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let approved, snapshot;
  if (parsed.mode === "reset-apply") {
    const approvedPath = fs.realpathSync(parsed["approved-plan"]);
    if (path.dirname(approvedPath) !== fs.realpathSync(directory)) fail("APPROVED_PLAN_PATH");
    const contents = fs.readFileSync(approvedPath);
    if (sha(contents) !== parsed["approved-plan-sha256"]) fail("APPROVED_PLAN_HASH_MISMATCH");
    approved = JSON.parse(contents);
    if (!approved.complete || approved.mode !== "reset-dry-run" || approved.plan.companyId !== tenantId || approved.plan.range.from !== parsed.from || approved.plan.range.to !== parsed.to) fail("APPROVED_PLAN_SCOPE_MISMATCH");
    snapshot = await verifyFlySnapshot({ app: env.FLY_APP_NAME, machineId: env.FLY_MACHINE_ID, volumeId: parsed["volume-id"], snapshotId: parsed["snapshot-id"],
      approvedAt: approved.finishedAt, token: env.ELSET_RESET_FLY_API_TOKEN, fetchImpl });
  }
  const db = openWorkspaceDb({ dbPath, fileMustExist: true, migrate: false });
  const transport = resetTransport(fetchImpl, { mode: parsed.mode, tenantId }), service = new AccountingService(db, { providerId: "quickbooks", env, fetchImpl: transport });
  const report = { schema: "elset-quickbooks-authoritative-reset-report-v1", mode: parsed.mode, startedAt: new Date().toISOString(), complete: false, apiAudit: transport.audit,
    dryRunBusinessWrites: 0, dryRunMappingWrites: 0, notes: ["One-time tool; no emails or Payment writes. Dry-run may maintain only encrypted OAuth credentials, retry metadata and the existing integration lock."] };
  let archiveSequence = 0;
  const journalPath = path.join(directory, `quickbooks-authoritative-reset-journal-${timestamp}.jsonl`);
  const journal = fs.openSync(journalPath, "wx", 0o600);
  const event = value => { fs.writeSync(journal, `${JSON.stringify(withoutSecrets({ at: new Date().toISOString(), ...value }))}\n`); fs.fsyncSync(journal); };
  const archive = async value => {
    const filename = path.join(directory, `quickbooks-authoritative-reset-archive-${timestamp}-${++archiveSequence}.json`);
    const data = JSON.stringify(withoutSecrets({ capturedAt: new Date().toISOString(), companyId: tenantId, range: { from: parsed.from, to: parsed.to }, ...value }), null, 2);
    const fd = fs.openSync(filename, "wx", 0o400);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (sha(fs.readFileSync(filename)) !== sha(data)) fail("ARCHIVE_REQUIRED");
    event({ archive: filename, sha256: sha(data), stage: value.stage }); return filename;
  };
  try {
    await service.work(async () => {
      const beforeMappings = db.prepare("SELECT * FROM integration_entity_mappings ORDER BY id").all();
      const financialSnapshot = () => fingerprint(["invoices", "invoice_line_items", "payments", "customers", "jobs"].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
      const beforeFinancial = financialSnapshot();
      const adapter = createResetAdapter(service, transport, parsed.mode, event), input = await adapter.load();
      report.company = input.organisation; report.plan = planReset(input, parsed); report.archivePath = await archive({ stage: parsed.mode === "reset-dry-run" ? "dry-run-live-snapshot" : "live-preflight", input, plan: report.plan });
      if (parsed.mode === "reset-apply") Object.assign(report, await applyReset(approved.plan, { adapter, archive, event, snapshot }));
      else {
        if (fingerprint(beforeMappings) !== fingerprint(db.prepare("SELECT * FROM integration_entity_mappings ORDER BY id").all()) || beforeFinancial !== financialSnapshot()) fail("DRY_RUN_DATA_CHANGED");
        if (transport.audit.quickbooksMutations !== 0) fail("DRY_RUN_WRITE_VIOLATION");
      }
      report.complete = true;
    });
  } catch (error) { report.stopped = safeCode(error); event({ stopped: report.stopped }); }
  finally { db.close(); fs.closeSync(journal); }
  report.finishedAt = new Date().toISOString(); report.journalPath = journalPath;
  if (!report.plan) { output(JSON.stringify({ complete: false, stopped: report.stopped, apiAudit: report.apiAudit, journalPath })); return 1; }
  const paths = writeResetReports(report, directory, timestamp);
  output(JSON.stringify({ complete: report.complete, mode: report.mode, range: report.plan.range, summary: report.plan.summary, apiAudit: report.apiAudit,
    stopped: report.stopped, reports: paths, archive: report.archivePath, journal: journalPath, exceptions: report.exceptions?.length,
    inv0252: report.plan.records.filter(row => row.invoiceNumber === "INV-0252").map(row => ({ invoiceNumber: row.invoiceNumber, canonicalId: row.canonicalId, actions: row.actions, duplicateIds: row.duplicateIds, reviews: row.reviews, warnings: row.warnings })) }, null, 2));
  return report.complete ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await resetCli(); }
  catch (error) { console.error(`${safeCode(error)}: ${error.code === "FLY_PRODUCTION_ONLY" || !error.code ? error.message : "Reset stopped; no secrets or provider response bodies are printed."}`); process.exitCode = 1; }
}
