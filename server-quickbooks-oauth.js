import crypto from "node:crypto";
import fs from "node:fs";
import { AccountingError } from "./server-accounting-errors.js";
import { decryptCredential, encryptCredential } from "./server-accounting-crypto.js";

const companySummary = (company) => ({ id: company.id, name: company.name, country: company.country, currency: company.currency });
const pendingContext = (service, pending) => service.aad(`company-switch:${pending.id}:${pending.environment}:${pending.previousRealmId}:${pending.organisation.id}`);
const pendingValue = (service) => JSON.parse(service.store.integration()?.credential_metadata_json || "{}").pendingCompanySwitch;

export function pendingQuickBooksCompany(service) {
  if (service.provider.id !== "quickbooks") return null;
  const pending = pendingValue(service), row = service.store.integration();
  if (!pending || pending.expiresAt <= Date.now() || pending.environment !== service.provider.environment || pending.previousRealmId !== row.external_tenant_id) return null;
  // Explicit projection: encrypted credentials and provider metadata never reach the browser.
  return { id: pending.id, current: { id: row.external_tenant_id, name: row.external_tenant_name },
    proposed: companySummary(pending.organisation), expiresAt: pending.expiresAt };
}

export function activateQuickBooksCompany(service, credentials, organisation, userId) {
  // Caller holds the integration lock. Credential rotation, metadata, realm and
  // configuration reset either all commit or all roll back.
  service.db.transaction(() => {
    const previous = service.store.integration();
    service.store.ensureIntegration();
    service.saveCredentials(credentials, service.provider.requiredScopes);
    service.store.update({ connected_by_user_id: previous?.connected_by_user_id || userId,
      connected_at: previous?.connected_at || new Date().toISOString(), last_error_at: null,
      provider_environment: service.provider.environment, organisations_json: JSON.stringify([organisation]) });
    service.selectOrganisation(organisation);
  })();
}

export function acceptQuickBooksCallback(service, credentials, organisation, userId) {
  const previous = service.store.integration();
  // Validate permissions/encryption before staging, without touching the active tokens.
  service.credentialValues(credentials, service.provider.requiredScopes);
  if (previous?.external_tenant_id && previous.external_tenant_id !== organisation.id) {
    const pending = { id: crypto.randomUUID(), environment: service.provider.environment,
      previousRealmId: previous.external_tenant_id, organisation, userId, expiresAt: Date.now() + 10 * 60_000 };
    pending.encryptedCredentials = encryptCredential(JSON.stringify(credentials), pendingContext(service, pending), service.env);
    // Existing server-only JSON metadata holds the encrypted, expiring proposal.
    // The active access/refresh tokens, realm, configuration and OAuth snapshot stay together.
    service.store.update({ credential_metadata_json: JSON.stringify({ ...JSON.parse(previous.credential_metadata_json), pendingCompanySwitch: pending }) });
    quickBooksOAuthDiagnostic(service.env, "switch_pending", { previousRealmId: previous.external_tenant_id,
      callbackRealmId: organisation.id, persistedRealmId: previous.external_tenant_id, company: organisation });
  } else {
    activateQuickBooksCompany(service, credentials, organisation, userId);
    quickBooksOAuthDiagnostic(service.env, "callback_persisted", { previousRealmId: previous?.external_tenant_id || "",
      callbackRealmId: organisation.id, persistedRealmId: service.store.integration().external_tenant_id, company: organisation });
  }
  return service.status();
}

export async function resolveQuickBooksCompanySwitch(service, switchId, confirm) {
  const summary = pendingQuickBooksCompany(service), pending = pendingValue(service);
  if (!summary || summary.id !== switchId || typeof confirm !== "boolean") {
    throw new AccountingError("COMPANY_SWITCH_EXPIRED", "This company switch expired or was replaced. Reconnect QuickBooks to select the company again.", 409);
  }
  if (!confirm) {
    const metadata = JSON.parse(service.store.integration().credential_metadata_json);
    delete metadata.pendingCompanySwitch;
    service.store.update({ credential_metadata_json: JSON.stringify(metadata) });
    return service.status();
  }
  const credentials = JSON.parse(decryptCredential(pending.encryptedCredentials, pendingContext(service, pending), service.env));
  const organisation = await service.provider.getOrganisation({ accessToken: credentials.accessToken, tenantId: pending.organisation.id });
  if (organisation.id !== pending.organisation.id) throw new AccountingError("INVALID_REALM", "QuickBooks did not verify the new company. Reconnect and try again.", 409);
  activateQuickBooksCompany(service, credentials, organisation, pending.userId);
  quickBooksOAuthDiagnostic(service.env, "company_switch_confirmed", { previousRealmId: pending.previousRealmId,
    callbackRealmId: pending.organisation.id, persistedRealmId: service.store.integration().external_tenant_id, company: organisation });
  return service.status();
}

export function quickBooksOAuthDiagnostic(env, event, fields = {}) {
  // Temporary, local Sandbox diagnosis only. Never emit callback URLs, codes,
  // state, tokens, credentials, customer records or arbitrary provider responses.
  if (env.QUICKBOOKS_OAUTH_DIAGNOSTICS === "0" || ![undefined, "", "development"].includes(env.NODE_ENV)
    || env.FLY_APP_NAME || env.FLY_MACHINE_ID || env.QUICKBOOKS_ENVIRONMENT !== "sandbox") return;
  let redirect;
  try { redirect = new URL(env.QUICKBOOKS_REDIRECT_URI); } catch { return; }
  if (redirect.protocol !== "http:" || redirect.hostname !== "localhost" || redirect.username || redirect.password || redirect.search || redirect.hash) return;
  const record = { at: new Date().toISOString(), event, environment: "sandbox" };
  for (const key of ["callbackRealmId", "previousRealmId", "persistedRealmId", "returnedRealmId"]) {
    if (typeof fields[key] === "string" && /^[0-9]{0,50}$/.test(fields[key])) record[key] = fields[key];
  }
  if (fields.company) {
    record.companyName = String(fields.company.name || "").replace(/[\r\n]/g, " ").slice(0, 200);
    record.country = String(fields.company.country || "").slice(0, 30);
    record.homeCurrency = String(fields.company.currency || "").slice(0, 10);
  }
  try {
    const directory = new URL("./output/", import.meta.url);
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(new URL("quickbooks-oauth-diagnostics.log", directory), `${JSON.stringify(record)}\n`);
  } catch { /* Diagnostics must never fail or partially persist a connection. */ }
}
