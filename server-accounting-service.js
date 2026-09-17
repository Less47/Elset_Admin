import crypto from "node:crypto";
import { AccountingStore } from "./server-accounting-store.js";
import { AccountingError, customerAccountingMessage, safeAccountingError } from "./server-accounting-errors.js";
import { accountingKey, decryptCredential, digest, encryptCredential } from "./server-accounting-crypto.js";
import { getAccountingProvider } from "./server-accounting-providers.js";
import { readAccountingInvoice, workspaceAccountingModel } from "./server-accounting-workspace.js";
import { getWorkspaceAddons, requireWorkspaceAddon } from "./server-workspace-addons.js";

export class AccountingService {
  constructor(db, { providerId = "xero", env = process.env, fetchImpl, provider } = {}) {
    this.db = db;
    this.env = env;
    this.provider = provider || getAccountingProvider(providerId, { env, fetchImpl });
    this.store = new AccountingStore(db, this.provider.id);
  }
  enabled() { return getWorkspaceAddons(this.db)[this.provider.id] === true; }
  aad(kind) { return `${this.store.workspaceId}:${this.provider.id}:${kind}`; }
  status() {
    const row = this.store.integration();
    let setupMessage = "";
    try { accountingKey(this.env); this.provider.configuration(); } catch (error) { setupMessage = safeAccountingError(error).message; }
    return { provider: this.provider.id, enabled: this.enabled(), status: row?.status || "DISCONNECTED",
      externalTenantId: row?.external_tenant_id || "", externalTenantName: row?.external_tenant_name || "",
      organisations: JSON.parse(row?.organisations_json || "[]"), config: JSON.parse(row?.config_json || "{}"),
      lastSuccessAt: row?.last_success_at || null, lastErrorAt: row?.last_error_at || null,
      error: customerAccountingMessage(row?.safe_error_message || ""), retryAt: row?.retry_after || 0,
      serverConfigured: !setupMessage, setupMessage, taxTreatments: workspaceAccountingModel.taxTreatments,
      syncBehaviour: "Manual" };
  }
  async work(action, { allowDisabled = false } = {}) {
    if (!allowDisabled) requireWorkspaceAddon(this.db, this.provider.id);
    return this.store.lock(async () => {
      try {
        if (!allowDisabled) {
          const retryAt = this.store.integration()?.retry_after || 0;
          if (retryAt > Date.now()) throw new AccountingError("RATE_LIMITED", "Wait before retrying Xero.", 429, Math.ceil((retryAt - Date.now()) / 1000));
        }
        return await action();
      } catch (cause) {
        const error = safeAccountingError(cause);
        if (this.store.integration()) this.store.update({ last_error_at: new Date().toISOString(), safe_error_message: error.message,
          ...(error.code === "NEEDS_REAUTHORIZATION" ? { status: "NEEDS_REAUTHORIZATION" } : {}),
          ...(error.retryAfter ? { retry_after: Date.now() + error.retryAfter * 1000 } : {}) });
        throw error;
      }
    });
  }
  saveCredentials(credentials, fallbackScopes = []) {
    const scopes = credentials.scopes || fallbackScopes;
    if (!this.provider.requiredScopes.every((scope) => scopes.includes(scope))) throw new AccountingError("NEEDS_REAUTHORIZATION", "Required accounting permissions were not granted. Reconnect and approve all requested scopes.", 409);
    // Both rotated credentials and expiry change in one SQLite statement.
    this.store.update({ encrypted_access_token: encryptCredential(credentials.accessToken, this.aad("access"), this.env),
      encrypted_refresh_token: encryptCredential(credentials.refreshToken, this.aad("refresh"), this.env),
      token_expires_at: credentials.expiresAt, granted_scopes: JSON.stringify(scopes) });
  }
  async credentials({ pending = false } = {}) {
    let row = this.store.integration();
    if (!row || row.status === "DISCONNECTED") throw new AccountingError("NOT_CONNECTED", "Xero not connected. Connect Xero from Settings → Add-ons.", 409);
    if (row.status === "NEEDS_REAUTHORIZATION") throw new AccountingError("NEEDS_REAUTHORIZATION", "Reconnect Xero from Settings → Add-ons before retrying.", 409);
    if (!pending && row.status !== "CONNECTED") throw new AccountingError("SELECT_ORGANISATION", "Choose the accounting organisation in Settings → Add-ons.", 409);
    const scopes = JSON.parse(row.granted_scopes);
    if (!this.provider.requiredScopes.every((scope) => scopes.includes(scope))) throw new AccountingError("NEEDS_REAUTHORIZATION", "Reconnect Xero to approve the required permissions.", 409);
    if (row.token_expires_at < Date.now() + 60_000) {
      const credentials = await this.provider.refreshCredentials(decryptCredential(row.encrypted_refresh_token, this.aad("refresh"), this.env));
      this.saveCredentials(credentials, scopes);
      row = this.store.integration();
    }
    return { accessToken: decryptCredential(row.encrypted_access_token, this.aad("access"), this.env), tenantId: row.external_tenant_id };
  }
  connect(userId, sessionId) {
    return this.work(() => {
      accountingKey(this.env);
      if (!userId || !sessionId) throw new AccountingError("SESSION_REQUIRED", "Sign in again before connecting accounting.", 401);
      const state = crypto.randomBytes(32).toString("base64url"), url = this.provider.connect(state);
      this.db.prepare("DELETE FROM integration_oauth_states WHERE expires_at < ? OR (workspace_id=? AND provider=? AND user_id=?)")
        .run(Date.now(), this.store.workspaceId, this.provider.id, userId);
      this.db.prepare("INSERT INTO integration_oauth_states VALUES(?,?,?,?,?,?)").run(digest(state), this.store.workspaceId, this.provider.id, userId, digest(sessionId), Date.now() + 600_000);
      return { url };
    });
  }
  callback({ state, code, error: oauthError }, userId, sessionId) {
    return this.work(async () => {
      if (typeof state !== "string" || !state || state.length > 256) throw new AccountingError("INVALID_OAUTH_STATE", "The Xero connection request is invalid. Start Connect to Xero again.", 400);
      const accepted = this.db.prepare(`DELETE FROM integration_oauth_states WHERE state_hash=? AND workspace_id=? AND provider=? AND user_id=? AND session_hash=? AND expires_at>?`)
        .run(digest(state || ""), this.store.workspaceId, this.provider.id, userId || "", digest(sessionId || ""), Date.now());
      if (!accepted.changes) throw new AccountingError("INVALID_OAUTH_STATE", "The Xero connection request expired or does not belong to this session. Start Connect to Xero again.", 400);
      if (oauthError === "access_denied") throw new AccountingError("OAUTH_CANCELLED", "Xero connection was cancelled or declined. Your existing records are unchanged.", 400);
      if (oauthError) throw new AccountingError("OAUTH_PROVIDER_ERROR", "Xero could not authorise this connection. Start Connect to Xero again.", 400);
      if (typeof code !== "string" || !code || code.length > 4096) throw new AccountingError("OAUTH_CODE", "Xero did not supply a valid authorization code. Connect again.");
      const credentials = await this.provider.exchangeCode(code);
      this.store.ensureIntegration();
      this.saveCredentials(credentials);
      this.store.update({ status: "SELECT_ORGANISATION", connected_by_user_id: userId, connected_at: new Date().toISOString(), safe_error_message: "", retry_after: 0 });
      const organisations = await this.provider.getOrganisations(credentials.accessToken);
      this.store.update({ organisations_json: JSON.stringify(organisations) });
      if (!organisations.length) throw new AccountingError("NO_ORGANISATION", "No eligible Xero organisation was returned. Reconnect and select an organisation.", 409);
      const row = this.store.integration();
      if (organisations.length === 1 && (!row.external_tenant_id || row.external_tenant_id === organisations[0].id)) this.selectOrganisation(organisations[0]);
      return this.status();
    });
  }
  selectOrganisation(organisation) {
    const current = this.store.integration();
    this.store.update({ external_tenant_id: organisation.id, external_tenant_name: organisation.name, external_connection_id: organisation.connectionId,
      status: "CONNECTED", safe_error_message: "", retry_after: 0,
      ...(current.external_tenant_id && current.external_tenant_id !== organisation.id ? { config_json: "{}", last_success_at: null } : {}) });
  }
  chooseOrganisation(tenantId, confirmChange) {
    return this.work(async () => {
      const context = await this.credentials({ pending: true });
      const organisations = await this.provider.getOrganisations(context.accessToken);
      const organisation = organisations.find((item) => item.id === tenantId);
      if (!organisation) throw new AccountingError("TENANT_UNAVAILABLE", "Choose an organisation authorised by the current Xero connection.", 409);
      const current = this.store.integration();
      if (current.external_tenant_id && current.external_tenant_id !== tenantId && confirmChange !== true) throw new AccountingError("TENANT_CHANGE", "This is a different Xero organisation. Confirm the change; existing mappings will remain with the old organisation and configuration must be selected again.", 409);
      this.selectOrganisation(organisation);
      return this.status();
    });
  }
  async options(context) {
    const organisations = await this.provider.getOrganisations(context.accessToken);
    if (!organisations.some((organisation) => organisation.id === context.tenantId)) throw new AccountingError("NEEDS_REAUTHORIZATION", "The selected organisation is no longer connected. Reconnect Xero.", 409);
    const [organisation, accounts, taxRates] = await Promise.all([this.provider.getOrganisation(context), this.provider.getAccounts(context), this.provider.getTaxRates(context)]);
    return { organisation, accounts, taxRates };
  }
  getConfig() { return this.work(async () => ({ ...this.status(), ...await this.options(await this.credentials()) })); }
  validateConfig(input, options) {
    const account = options.accounts.find((item) => item.id === input.salesAccountId);
    if (!account) throw new AccountingError("ACCOUNT_MAPPING", "Select an active Xero sales/revenue account.", 409);
    const taxMappings = {};
    for (const treatment of workspaceAccountingModel.taxTreatments) {
      const tax = options.taxRates.find((item) => item.id === input.taxMappings?.[treatment.key] && item.rate === treatment.rate);
      if (!tax) throw new AccountingError("TAX_MAPPING", `Select a revenue tax rate matching ${treatment.label}.`, 409);
      taxMappings[treatment.key] = tax.id;
    }
    if (options.organisation.currency !== workspaceAccountingModel.currency) throw new AccountingError("CURRENCY_MISMATCH", `This workspace invoices in ${workspaceAccountingModel.currency}. V1 requires an accounting organisation with the same base currency.`, 409);
    return { salesAccountId: account.id, salesAccountCode: account.code, taxMappings };
  }
  configure(input) {
    return this.work(async () => {
      const options = await this.options(await this.credentials());
      const config = this.validateConfig(input || {}, options);
      this.store.update({ config_json: JSON.stringify(config), safe_error_message: "" });
      return { ...this.status(), ...options };
    });
  }
  testConnection() {
    return this.work(async () => {
      const options = await this.options(await this.credentials());
      this.store.update({ safe_error_message: "", retry_after: 0 });
      return { ...this.status(), ...options, message: "Connection verified. No contacts or invoices were created." };
    });
  }
  disconnect() {
    return this.work(async () => {
      const row = this.store.integration();
      if (!row) return this.status();
      let warning = "";
      try {
        if (row.external_connection_id && row.encrypted_access_token) {
          const context = await this.credentials({ pending: true });
          await this.provider.disconnect(context.accessToken, row.external_connection_id);
        } else if (row.encrypted_access_token) {
          warning = "Disconnected locally. No organisation had been selected; remove this app from Xero Connected Apps in any organisations you authorised.";
        }
      } catch { warning = "Disconnected locally. Xero could not confirm removal; remove this app from Xero Connected Apps if it is still listed."; }
      this.store.update({ status: "DISCONNECTED", encrypted_access_token: null, encrypted_refresh_token: null, token_expires_at: 0,
        granted_scopes: "[]", organisations_json: "[]", safe_error_message: warning, retry_after: 0 });
      this.db.prepare("DELETE FROM integration_oauth_states WHERE workspace_id=? AND provider=?").run(this.store.workspaceId, this.provider.id);
      this.store.log(row.external_tenant_id, "connection", row.id, "disconnect", "DISCONNECTED");
      return this.status();
    }, { allowDisabled: true });
  }
  invoiceStatus(jobId) {
    const invoice = readAccountingInvoice(this.db, jobId), connection = this.status(), tenant = connection.externalTenantId;
    const mapping = this.store.mapping(tenant, "invoice", invoice.id), latest = this.store.latest(tenant, "invoice", invoice.id);
    const locked = this.store.isLocked();
    const status = latest?.status === "SYNCING" && !locked ? "FAILED" : latest?.status || "NOT_SYNCED";
    return { connection, eligible: invoice.eligible, reason: invoice.reason, status,
      externalId: mapping?.external_entity_id || "", externalReference: mapping?.external_reference || "",
      lastSyncedAt: this.db.prepare("SELECT created_at FROM integration_sync_log WHERE workspace_id=? AND provider=? AND external_tenant_id=? AND entity_type='invoice' AND entity_id=? AND status='SYNCED' ORDER BY id DESC LIMIT 1")
        .get(this.store.workspaceId, this.provider.id, tenant, invoice.id)?.created_at || null,
      error: customerAccountingMessage(latest?.safe_error_message || (latest?.status === "SYNCING" && !locked ? "The previous request was interrupted. Retry to reconcile its result." : "")) };
  }
  syncInvoice(jobId) {
    return this.work(async () => {
      const source = readAccountingInvoice(this.db, jobId);
      if (!source.eligible) throw new AccountingError("INVOICE_INELIGIBLE", source.reason, 409);
      const tenant = this.store.integration()?.external_tenant_id || "";
      this.store.log(tenant, "invoice", source.id, "sync", "SYNCING");
      try {
        const context = await this.credentials();
        const config = this.validateConfig(JSON.parse(this.store.integration().config_json), await this.options(context));
        const mappedCustomer = this.store.mapping(tenant, "customer", source.customerId);
        const customer = mappedCustomer ? await this.provider.getCustomer(context, mappedCustomer.external_entity_id)
          : await this.provider.ensureCustomer(context, source.customer, `ops-${digest(`${this.store.workspaceId}:${source.customerId}`).slice(0, 40)}`,
            async (payload, write) => {
              requireWorkspaceAddon(this.db, this.provider.id);
              const key = this.store.prepareOperation(tenant, "customer", source.customerId, payload);
              try { return await write(key); }
              catch (error) { if (error.code === "PROVIDER_VALIDATION") this.store.finishOperation(tenant, "customer", source.customerId, "REJECTED"); throw error; }
            });
        this.store.map(tenant, "customer", source.customerId, customer.id, customer.reference);
        this.store.finishOperation(tenant, "customer", source.customerId);
        const payload = this.provider.invoicePayload(source, customer.id, config, `ops-${digest(`${this.store.workspaceId}:${source.id}`).slice(0, 24)}`);
        const mapping = this.store.mapping(tenant, "invoice", source.id);
        let external;
        if (mapping) {
          external = await this.provider.getInvoice(context, mapping.external_entity_id);
          this.provider.assertUpdateSafe(external);
          if (!this.provider.matchesInvoice(external, payload)) {
            if (this.provider.describeInvoice(external).fingerprint !== mapping.external_fingerprint) throw new AccountingError("EXTERNAL_EDIT_CONFLICT", "The Xero invoice changed since the last sync. Review the accounting changes before updating.", 409);
            requireWorkspaceAddon(this.db, this.provider.id);
            const key = this.store.prepareOperation(tenant, "invoice", source.id, payload);
            external = await this.provider.updateInvoice(context, external, payload, key);
          }
        } else {
          const matches = await this.provider.findInvoice(context, source.number);
          if (matches.length) {
            if (matches.length !== 1 || !this.provider.matchesInvoice(matches[0], payload)) throw new AccountingError("INVOICE_NUMBER_CONFLICT", "This invoice number already exists in Xero with different details. Review it; no duplicate or replacement was created.", 409);
            external = matches[0];
          } else {
            requireWorkspaceAddon(this.db, this.provider.id);
            const key = this.store.prepareOperation(tenant, "invoice", source.id, payload);
            external = await this.provider.createInvoice(context, payload, key);
          }
        }
        const result = this.provider.describeInvoice(external);
        if (!result.id) throw new AccountingError("INVOICE_RESPONSE", "Xero did not confirm an invoice ID. Retry to reconcile.", 502);
        // Save the external identity even if totals require reconciliation.
        this.store.map(tenant, "invoice", source.id, result.id, result.number, result.fingerprint);
        this.store.finishOperation(tenant, "invoice", source.id);
        if (["subtotalCents", "taxCents", "totalCents"].some((field) => !Number.isSafeInteger(result[field]) || result[field] !== source[field])) {
          throw new AccountingError("TOTALS_MISMATCH", "Xero subtotal, tax or total differs from the saved invoice. The external ID was retained; review totals before retrying.", 409);
        }
        if (!this.provider.matchesInvoice(external, payload)) throw new AccountingError("INVOICE_CONTENT_MISMATCH", "Xero returned different invoice details. The external ID was retained; review the invoice before retrying.", 409);
        if (digest(JSON.stringify(readAccountingInvoice(this.db, jobId))) !== digest(JSON.stringify(source))) throw new AccountingError("LOCAL_EDIT_CONFLICT", "The saved invoice changed while syncing. The Xero ID was retained; review and update again.", 409);
        this.store.log(tenant, "invoice", source.id, mapping ? "update" : "create", "SYNCED", result.id);
        this.store.update({ last_success_at: new Date().toISOString(), safe_error_message: "", retry_after: 0 });
        return this.invoiceStatus(jobId);
      } catch (cause) {
        const error = safeAccountingError(cause);
        if (error.code === "PROVIDER_VALIDATION") this.store.finishOperation(tenant, "invoice", source.id, "REJECTED");
        this.store.log(tenant, "invoice", source.id, "sync", error.code === "NEEDS_REAUTHORIZATION" ? "NEEDS_REAUTHORIZATION" : error.statusCode === 409 ? "CONFLICT" : "FAILED", "", error);
        throw error;
      }
    });
  }
}
