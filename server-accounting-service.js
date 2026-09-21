import crypto from "node:crypto";
import { AccountingStore } from "./server-accounting-store.js";
import { AccountingError, customerAccountingMessage, safeAccountingError } from "./server-accounting-errors.js";
import { accountingKey, decryptCredential, digest, encryptCredential } from "./server-accounting-crypto.js";
import { getAccountingProvider } from "./server-accounting-providers.js";
import { readAccountingInvoice, workspaceAccountingModel } from "./server-accounting-workspace.js";
import { getWorkspaceAddons, requireWorkspaceAddon } from "./server-workspace-addons.js";
import { paymentSyncStatus, reconcileInvoicePayments, reconcilePaymentGroup } from "./server-accounting-payments.js";
import { loadWorkspaceStateFromDb } from "./server-workspace-state.js";
import { assertInvoiceAccountingOwner } from "./server-accounting-payment-policy.js";
import { acceptQuickBooksCallback, pendingQuickBooksCompany, quickBooksOAuthDiagnostic, resolveQuickBooksCompanySwitch } from "./server-quickbooks-oauth.js";

export class AccountingService {
  constructor(db, { providerId = "xero", env = process.env, fetchImpl, provider, authorizeOAuthInitiator = async () => false } = {}) {
    this.db = db;
    this.env = env;
    this.provider = provider || getAccountingProvider(providerId, { env, fetchImpl });
    this.store = new AccountingStore(db, this.provider.id);
    this.authorizeOAuthInitiator = authorizeOAuthInitiator;
  }
  enabled() { return getWorkspaceAddons(this.db)[this.provider.id] === true; }
  aad(kind) { return `${this.store.workspaceId}:${this.provider.id}:${kind}`; }
  assertEnvironment() {
    const saved = this.store.integration()?.provider_environment;
    if (saved && saved !== this.provider.environment) throw new AccountingError("ENVIRONMENT_MISMATCH", "This workspace's QuickBooks history belongs to a different environment. Use a separate workspace database for Sandbox and production; existing credentials and mappings cannot be reused.", 409);
  }
  status() {
    const row = this.store.integration();
    let setupMessage = "";
    try { accountingKey(this.env); this.provider.configuration(); this.assertEnvironment(); } catch (error) { setupMessage = safeAccountingError(error).message; }
    if (this.provider.id === "quickbooks") quickBooksOAuthDiagnostic(this.env, "status_returned", { returnedRealmId: row?.external_tenant_id || "" });
    return { provider: this.provider.id, enabled: this.enabled(), status: row?.status || "DISCONNECTED",
      externalTenantId: row?.external_tenant_id || "", externalTenantName: row?.external_tenant_name || "",
      organisations: JSON.parse(row?.organisations_json || "[]"), config: JSON.parse(row?.config_json || "{}"),
      lastSuccessAt: row?.last_success_at || null, lastErrorAt: row?.last_error_at || null,
      error: customerAccountingMessage(row?.safe_error_message || ""), retryAt: row?.retry_after || 0,
      serverConfigured: !setupMessage, setupMessage, taxTreatments: workspaceAccountingModel.taxTreatments,
      environment: row?.provider_environment || this.provider.environment || "", providerName: this.provider.name,
      ...(this.provider.id === "quickbooks" ? { pendingCompanySwitch: pendingQuickBooksCompany(this) } : {}),
      paymentSync: row?.status !== "CONNECTED" ? "NOT_CONNECTED" : JSON.parse(row.granted_scopes).includes(this.provider.paymentScope) ? "CONNECTED" : "PAYMENT_PERMISSION_REQUIRED",
      syncBehaviour: "Manual invoices; webhook and manual payment reconciliation" };
  }
  async work(action, { allowDisabled = false, recordFailure = true } = {}) {
    if (!allowDisabled) requireWorkspaceAddon(this.db, this.provider.id);
    return this.store.lock(async () => {
      try {
        this.assertEnvironment();
        if (!allowDisabled) {
          const retryAt = this.store.integration()?.retry_after || 0;
          if (retryAt > Date.now()) throw new AccountingError("RATE_LIMITED", `Wait before retrying ${this.provider.name}.`, 429, Math.ceil((retryAt - Date.now()) / 1000));
        }
        return await action();
      } catch (cause) {
        const error = safeAccountingError(cause);
        if (recordFailure && error.code !== "COMPANY_SWITCH_PENDING" && this.store.integration()) this.store.update({ last_error_at: new Date().toISOString(), safe_error_message: error.message,
          ...(error.code === "NEEDS_REAUTHORIZATION" ? { status: "NEEDS_REAUTHORIZATION" } : {}),
          ...(error.retryAfter ? { retry_after: Date.now() + error.retryAfter * 1000 } : {}) });
        throw error;
      }
    });
  }
  credentialValues(credentials, fallbackScopes = []) {
    const scopes = credentials.scopes || fallbackScopes;
    if (!this.provider.requiredScopes.every((scope) => scopes.includes(scope))) throw new AccountingError("NEEDS_REAUTHORIZATION", "Required accounting permissions were not granted. Reconnect and approve all requested scopes.", 409);
    // Both rotated credentials and expiry change in one SQLite statement.
    return { encrypted_access_token: encryptCredential(credentials.accessToken, this.aad("access"), this.env),
      encrypted_refresh_token: encryptCredential(credentials.refreshToken, this.aad("refresh"), this.env),
      token_expires_at: credentials.expiresAt, granted_scopes: JSON.stringify(scopes),
      credential_metadata_json: JSON.stringify(credentials.metadata || {}) };
  }
  saveCredentials(credentials, fallbackScopes = []) {
    this.store.update(this.credentialValues(credentials, fallbackScopes));
  }
  async credentials({ pending = false } = {}) {
    this.assertEnvironment();
    let row = this.store.integration();
    if (pendingQuickBooksCompany(this)) throw new AccountingError("COMPANY_SWITCH_PENDING", "Confirm or cancel the QuickBooks company switch in Settings before continuing.", 409);
    if (this.provider.id === "quickbooks" && row?.status !== "DISCONNECTED"
      && JSON.parse(row?.organisations_json || "[]")[0]?.id !== row?.external_tenant_id) {
      throw new AccountingError("REALM_MISMATCH", "The saved QuickBooks company does not match its authorization. Reconnect QuickBooks to verify and activate the company.", 409);
    }
    if (!row || row.status === "DISCONNECTED") throw new AccountingError("NOT_CONNECTED", `${this.provider.name} not connected. Connect ${this.provider.name} from Settings → Add-ons.`, 409);
    if (row.status === "NEEDS_REAUTHORIZATION") throw new AccountingError("NEEDS_REAUTHORIZATION", `Reconnect ${this.provider.name} from Settings → Add-ons before retrying.`, 409);
    if (!pending && row.status !== "CONNECTED") throw new AccountingError("SELECT_ORGANISATION", "Choose the accounting organisation in Settings → Add-ons.", 409);
    const scopes = JSON.parse(row.granted_scopes);
    if (!this.provider.requiredScopes.every((scope) => scopes.includes(scope))) throw new AccountingError("NEEDS_REAUTHORIZATION", `Reconnect ${this.provider.name} to approve the required permissions.`, 409);
    if (row.token_expires_at < Date.now() + 60_000) {
      const credentials = await this.provider.refreshCredentials(decryptCredential(row.encrypted_refresh_token, this.aad("refresh"), this.env));
      this.saveCredentials(credentials, scopes);
      row = this.store.integration();
    }
    return { accessToken: decryptCredential(row.encrypted_access_token, this.aad("access"), this.env), tenantId: row.external_tenant_id,
      authorisedTenantId: this.provider.id === "quickbooks" ? JSON.parse(row.organisations_json)[0]?.id : undefined };
  }
  connect(userId, sessionId) {
    return this.work(() => {
      accountingKey(this.env);
      if (!userId || !sessionId) throw new AccountingError("SESSION_REQUIRED", "Sign in again before connecting accounting.", 401);
      const state = `accounting-connect-v1.${crypto.randomBytes(32).toString("base64url")}`, url = this.provider.connect(state);
      this.db.prepare("DELETE FROM integration_oauth_states WHERE expires_at < ? OR (workspace_id=? AND provider=? AND user_id=?)")
        .run(Date.now(), this.store.workspaceId, this.provider.id, userId);
      this.db.prepare("INSERT INTO integration_oauth_states VALUES(?,?,?,?,?,?,?)").run(digest(state), this.store.workspaceId, this.provider.id, userId, digest(sessionId), Date.now() + 600_000, this.provider.environment || "");
      if (this.provider.id === "quickbooks") quickBooksOAuthDiagnostic(this.env, "connect_created", { previousRealmId: this.store.integration()?.external_tenant_id || "" });
      return { url };
    });
  }
  async callback({ state, code, realmId, error: oauthError }, userId, sessionId) {
    const invalid = () => new AccountingError("INVALID_OAUTH_STATE", "The accounting connection request expired or is invalid. Start Connect again.", 400);
    if (typeof state !== "string" || !/^accounting-connect-v1\.[A-Za-z0-9_-]{43}$/.test(state)) throw invalid();
    const row = this.db.prepare("SELECT * FROM integration_oauth_states WHERE state_hash=? AND workspace_id=? AND provider=? AND expires_at>?")
      .get(digest(state), this.store.workspaceId, this.provider.id, Date.now());
    if (!row || row.provider_environment !== (this.provider.environment || "")
      || (userId && row.user_id !== userId) || (sessionId && row.session_hash !== digest(sessionId))) throw invalid();
    const accepted = this.db.prepare("DELETE FROM integration_oauth_states WHERE state_hash=? AND expires_at>? RETURNING *").get(row.state_hash, Date.now());
    if (!accepted || !await this.authorizeOAuthInitiator(accepted)) throw invalid();
    // Invalid/cancelled public callbacks never modify an existing connection's health.
    if (oauthError === "access_denied") throw new AccountingError("OAUTH_CANCELLED", `${this.provider.name} connection was cancelled or declined. Your existing records are unchanged.`, 400);
    if (oauthError) throw new AccountingError("OAUTH_PROVIDER_ERROR", `${this.provider.name} could not authorise this connection. Start Connect to ${this.provider.name} again.`, 400);
    if (typeof code !== "string" || !code || code.length > 4096) throw new AccountingError("OAUTH_CODE", `${this.provider.name} did not supply a valid authorization code. Connect again.`);
    if (this.provider.validateCallback) this.provider.validateCallback({ realmId });
    return this.work(async () => {
      if (this.provider.id === "quickbooks") quickBooksOAuthDiagnostic(this.env, "callback_received", { callbackRealmId: realmId, previousRealmId: this.store.integration()?.external_tenant_id || "" });
      const credentials = await this.provider.exchangeCode(code);
      const organisations = await this.provider.getOrganisations(credentials.accessToken, { realmId });
      if (this.provider.id === "quickbooks") {
        if (organisations.length !== 1 || organisations[0].id !== realmId) throw new AccountingError("INVALID_REALM", "QuickBooks did not verify the authorised company. Reconnect and try again.", 409);
        quickBooksOAuthDiagnostic(this.env, "company_verified", { callbackRealmId: realmId, previousRealmId: this.store.integration()?.external_tenant_id || "", company: organisations[0] });
        return acceptQuickBooksCallback(this, credentials, organisations[0], accepted.user_id);
      }
      const previous = this.store.integration();
      this.store.ensureIntegration();
      this.db.transaction(() => {
        this.saveCredentials(credentials, this.provider.requiredScopes);
        this.store.update({ status: "SELECT_ORGANISATION", connected_by_user_id: previous?.connected_by_user_id || accepted.user_id,
          connected_at: previous?.connected_at || new Date().toISOString(), safe_error_message: "", retry_after: 0,
          provider_environment: this.provider.environment || "", organisations_json: JSON.stringify(organisations) });
      })();
      if (!organisations.length) throw new AccountingError("NO_ORGANISATION", `No eligible ${this.provider.name} organisation was returned. Reconnect and select an organisation.`, 409);
      const row = this.store.integration();
      const previousOrganisation = organisations.find((organisation) => organisation.id === row.external_tenant_id);
      if (previousOrganisation) this.selectOrganisation(previousOrganisation);
      else if (organisations.length === 1 && !row.external_tenant_id) this.selectOrganisation(organisations[0]);
      return this.status();
    }, { recordFailure: this.provider.id !== "quickbooks" });
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
      const organisations = await this.provider.getOrganisations(context.accessToken, { realmId: context.authorisedTenantId || context.tenantId });
      const organisation = organisations.find((item) => item.id === tenantId);
      if (!organisation) throw new AccountingError("TENANT_UNAVAILABLE", `Choose an organisation authorised by the current ${this.provider.name} connection.`, 409);
      const current = this.store.integration();
      if (current.external_tenant_id && current.external_tenant_id !== tenantId && confirmChange !== true) throw new AccountingError("TENANT_CHANGE", `This is a different ${this.provider.name} organisation. Confirm the change; existing mappings will remain with the old organisation and configuration must be selected again.`, 409);
      this.selectOrganisation(organisation);
      return this.status();
    });
  }
  switchCompany(switchId, confirm) {
    if (this.provider.id !== "quickbooks") throw new AccountingError("PROVIDER_OPERATION", "This provider uses organisation selection.", 400);
    return this.work(() => resolveQuickBooksCompanySwitch(this, switchId, confirm), { recordFailure: false });
  }
  async options(context) {
    const organisations = await this.provider.getOrganisations(context.accessToken, { realmId: context.authorisedTenantId || context.tenantId });
    if (!organisations.some((organisation) => organisation.id === context.tenantId)) throw new AccountingError("NEEDS_REAUTHORIZATION", `The selected organisation is no longer connected. Reconnect ${this.provider.name}.`, 409);
    const [organisation, accounts, taxRates] = await Promise.all([this.provider.getOrganisation(context), this.provider.getAccounts(context), this.provider.getTaxRates(context)]);
    const options = { organisation, accounts, taxRates, ...(this.provider.getItems ? { items: await this.provider.getItems(context) } : {}) };
    return { ...options, ...(this.provider.configurationIssue ? { configurationIssue: this.provider.configurationIssue(options, workspaceAccountingModel) } : {}) };
  }
  getConfig() { return this.work(async () => {
    const options = await this.options(await this.credentials());
    if (this.provider.id === "quickbooks") quickBooksOAuthDiagnostic(this.env, "config_returned", { returnedRealmId: options.organisation.id, company: options.organisation });
    return { ...this.status(), ...options };
  }); }
  validateConfig(input, options) {
    if (this.provider.validateConfig) return this.provider.validateConfig(input, options, workspaceAccountingModel);
    const account = options.accounts.find((item) => item.id === input.salesAccountId);
    if (!account) throw new AccountingError("ACCOUNT_MAPPING", `Select an active ${this.provider.name} sales/revenue account.`, 409);
    const taxMappings = {};
    for (const treatment of workspaceAccountingModel.taxTreatments) {
      const tax = options.taxRates.find((item) => item.id === input.taxMappings?.[treatment.key] && item.rate === treatment.rate);
      if (!tax) throw new AccountingError("TAX_MAPPING", `Select a revenue tax rate matching ${treatment.label}.`, 409);
      taxMappings[treatment.key] = tax.id;
    }
    if (options.organisation.currency !== workspaceAccountingModel.currency) throw new AccountingError("CURRENCY_MISMATCH", `This workspace invoices in ${workspaceAccountingModel.currency}. Select an accounting organisation with the same base currency.`, 409);
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
        if (this.provider.revokeCredentials && row.encrypted_refresh_token) {
          await this.provider.revokeCredentials(decryptCredential(row.encrypted_refresh_token, this.aad("refresh"), this.env));
        } else if (row.external_connection_id && row.encrypted_access_token) {
          const context = await this.credentials({ pending: true });
          await this.provider.disconnect(context.accessToken, row.external_connection_id);
        } else if (row.encrypted_access_token) {
          warning = `Disconnected locally. No organisation had been selected; remove this app from ${this.provider.name} Connected Apps in any organisations you authorised.`;
        }
      } catch { warning = `Disconnected locally. ${this.provider.name} could not confirm removal; remove this app from ${this.provider.name} Connected Apps if it is still listed.`; }
      this.store.update({ status: "DISCONNECTED", encrypted_access_token: null, encrypted_refresh_token: null, token_expires_at: 0,
        granted_scopes: "[]", credential_metadata_json: "{}", organisations_json: "[]", safe_error_message: warning, retry_after: 0 });
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
    let ownershipError = "";
    try { assertInvoiceAccountingOwner(this.db, invoice.id, this.provider.id, tenant); } catch (error) { ownershipError = error.message; }
    return { connection, eligible: invoice.eligible && !ownershipError, reason: ownershipError || invoice.reason, status, paymentSync: paymentSyncStatus(this, invoice.id),
      invoice: loadWorkspaceStateFromDb(this.db).jobs.find((job) => job.id === jobId).invoice,
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
      assertInvoiceAccountingOwner(this.db, source.id, this.provider.id, tenant);
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
            if (this.provider.describeInvoice(external).fingerprint !== mapping.external_fingerprint) throw new AccountingError("EXTERNAL_EDIT_CONFLICT", `The ${this.provider.name} invoice changed since the last sync. Review the accounting changes before updating.`, 409);
            requireWorkspaceAddon(this.db, this.provider.id);
            const key = this.store.prepareOperation(tenant, "invoice", source.id, payload);
            external = await this.provider.updateInvoice(context, external, payload, key);
          }
        } else {
          const matches = await this.provider.findInvoice(context, source.number);
          if (matches.length) {
            if (matches.length !== 1 || !this.provider.matchesInvoice(matches[0], payload)) throw new AccountingError("INVOICE_NUMBER_CONFLICT", `This invoice number already exists in ${this.provider.name} with different details. Review it; no duplicate or replacement was created.`, 409);
            external = matches[0];
          } else {
            requireWorkspaceAddon(this.db, this.provider.id);
            const key = this.store.prepareOperation(tenant, "invoice", source.id, payload);
            external = await this.provider.createInvoice(context, payload, key);
          }
        }
        const result = this.provider.describeInvoice(external);
        if (!result.id) throw new AccountingError("INVOICE_RESPONSE", `${this.provider.name} did not confirm an invoice ID. Retry to reconcile.`, 502);
        // Save the external identity even if totals require reconciliation.
        this.store.map(tenant, "invoice", source.id, result.id, result.number, result.fingerprint, result.version || "");
        this.store.finishOperation(tenant, "invoice", source.id);
        if (["subtotalCents", "taxCents", "totalCents"].some((field) => !Number.isSafeInteger(result[field]) || result[field] !== source[field])) {
          throw new AccountingError(this.provider.id === "quickbooks" ? "ACCOUNTING_REVIEW_REQUIRED" : "TOTALS_MISMATCH", `${this.provider.name} subtotal, tax or total differs from the saved invoice. The external ID was retained; review totals before retrying.`, 409);
        }
        if (!this.provider.matchesInvoice(external, payload)) throw new AccountingError("INVOICE_CONTENT_MISMATCH", `${this.provider.name} returned different invoice details. The external ID was retained; review the invoice before retrying.`, 409);
        if (digest(JSON.stringify(readAccountingInvoice(this.db, jobId))) !== digest(JSON.stringify(source))) throw new AccountingError("LOCAL_EDIT_CONFLICT", `The saved invoice changed while syncing. The ${this.provider.name} ID was retained; review and update again.`, 409);
        this.store.log(tenant, "invoice", source.id, mapping ? "update" : "create", "SYNCED", result.id);
        this.store.update({ last_success_at: new Date().toISOString(), safe_error_message: "", retry_after: 0 });
        return this.invoiceStatus(jobId);
      } catch (cause) {
        const error = safeAccountingError(cause);
        if (error.code === "PROVIDER_VALIDATION" || error.writeRejected) this.store.finishOperation(tenant, "invoice", source.id, "REJECTED");
        this.store.log(tenant, "invoice", source.id, "sync", error.code === "NEEDS_REAUTHORIZATION" ? "NEEDS_REAUTHORIZATION" : error.statusCode === 409 ? "CONFLICT" : "FAILED", "", error);
        throw error;
      }
    });
  }
  syncPayments(jobId, options) { return this.provider.multipleInvoicePayments ? reconcilePaymentGroup(this, jobId, options) : reconcileInvoicePayments(this, jobId, options); }
}
