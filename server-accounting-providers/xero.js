import { AccountingError, accountingInfrastructureError } from "../server-accounting-errors.js";
import { digest } from "../server-accounting-crypto.js";
import process from "node:process";
import { Buffer } from "node:buffer";

export const XERO_SCOPES = Object.freeze(["offline_access", "accounting.contacts", "accounting.invoices", "accounting.settings.read"]);
const API = "https://api.xero.com/api.xro/2.0/";
const IDENTITY = "https://identity.xero.com/connect/";
const cents = (value) => Math.round(Number(value) * 100);
const day = (value) => {
  if (/^\d{4}-\d{2}-\d{2}/.test(value || "")) return value.slice(0, 10);
  const match = String(value).match(/^\/Date\((-?\d+)/);
  return match ? new Date(Number(match[1])).toISOString().slice(0, 10) : "";
};
function comparable(invoice) {
  return { type: invoice.Type, number: invoice.InvoiceNumber, contact: invoice.Contact?.ContactID,
    date: day(invoice.DateString || invoice.Date), dueDate: day(invoice.DueDateString || invoice.DueDate),
    currency: invoice.CurrencyCode, amountType: invoice.LineAmountTypes, reference: invoice.Reference || "",
    lines: (invoice.LineItems || []).map((line) => ({ description: line.Description || "", quantity: Number(line.Quantity),
      unit: Number(line.UnitAmount), amount: cents(line.LineAmount), tax: cents(line.TaxAmount), account: line.AccountCode, taxType: line.TaxType })) };
}

export class XeroAccountingProvider {
  constructor({ env = process.env, fetchImpl = fetch } = {}) {
    this.id = "xero";
    this.name = "Xero";
    this.requiredScopes = XERO_SCOPES;
    this.env = env;
    this.fetch = fetchImpl;
  }
  configuration() {
    const { XERO_CLIENT_ID: clientId, XERO_CLIENT_SECRET: secret, XERO_REDIRECT_URI: redirect } = this.env;
    const missing = ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_REDIRECT_URI"].filter((name) => !this.env[name]);
    if (missing.length) throw accountingInfrastructureError(`missing ${missing.join(", ")}`);
    let url;
    try { url = new URL(redirect); } catch { /* handled below */ }
    if (!url || url.username || url.password || url.hash || url.search
      || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))) {
      throw accountingInfrastructureError("invalid XERO_REDIRECT_URI: expected an HTTPS callback or HTTP localhost without credentials, query or fragment");
    }
    return { clientId, secret, redirect };
  }
  connect(state) {
    const { clientId, redirect } = this.configuration();
    const url = new URL("https://login.xero.com/identity/connect/authorize");
    url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, scope: XERO_SCOPES.join(" "), state }).toString();
    return url.href;
  }
  async http(url, options = {}, { token = false } = {}) {
    let response;
    try { response = await this.fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20_000) }); }
    catch { throw new AccountingError("PROVIDER_UNAVAILABLE", "Xero did not confirm the request. Retry to reconcile its result safely.", 503); }
    let body;
    try { body = await response.json(); } catch { body = null; }
    if (response.status === 429) {
      const raw = response.headers.get("retry-after");
      const seconds = /^\d+$/.test(raw || "") ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
      throw new AccountingError("RATE_LIMITED", "Xero is limiting requests. Retry after the displayed waiting period.", 429, Number.isFinite(seconds) ? Math.max(1, seconds) : 60);
    }
    if (response.status === 401 || response.status === 403 || (token && body?.error === "invalid_grant")) {
      throw new AccountingError("NEEDS_REAUTHORIZATION", "Xero access needs to be renewed. Reconnect Xero from Settings → Add-ons and approve the required permissions.", 409);
    }
    if (response.status === 404) throw new AccountingError("EXTERNAL_NOT_FOUND", "The mapped record or organisation is no longer available in Xero. Review it before retrying.", 409);
    if (!response.ok || body?.Elements?.some((entry) => entry.HasErrors) || body?.Invoices?.some((entry) => entry.HasErrors) || body?.Contacts?.some((entry) => entry.HasErrors)) {
      if (response.status >= 500) throw new AccountingError("PROVIDER_UNAVAILABLE", "Xero is temporarily unavailable. Retry to reconcile the result safely.", 503);
      throw new AccountingError("PROVIDER_VALIDATION", "Xero rejected the request. Check the account, tax mapping, dates, contact details and invoice number for conflicts.", 422);
    }
    return body;
  }
  async tokenRequest(parameters) {
    const { clientId, secret } = this.configuration();
    const result = await this.http(`${IDENTITY}token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}` }, body: new URLSearchParams(parameters).toString() }, { token: true });
    if (!result?.access_token || !result.refresh_token || !(Number(result.expires_in) > 0)) throw new AccountingError("OAUTH_RESPONSE", "Xero returned incomplete credentials. Connect again.", 502);
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + Number(result.expires_in) * 1000,
      scopes: typeof result.scope === "string" ? result.scope.split(/\s+/) : null };
  }
  exchangeCode(code) { return this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: this.configuration().redirect }); }
  refreshCredentials(refreshToken) { return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }); }
  async getOrganisations(accessToken) {
    const body = await this.http("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (!Array.isArray(body)) throw new AccountingError("OAUTH_RESPONSE", "Xero organisations could not be read. Try again.", 502);
    return body.filter((row) => row.tenantType === "ORGANISATION").map((row) => ({ id: row.tenantId, name: row.tenantName, connectionId: row.id }));
  }
  disconnect(accessToken, connectionId) {
    return this.http(`https://api.xero.com/connections/${encodeURIComponent(connectionId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
  }
  request(context, endpoint, method = "GET", body, key) {
    return this.http(`${API}${endpoint}`, { method, headers: { Authorization: `Bearer ${context.accessToken}`, "xero-tenant-id": context.tenantId, Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async getOrganisation(context) {
    const result = await this.request(context, "Organisation");
    const org = result?.Organisations?.[0];
    if (!org) throw new AccountingError("ORGANISATION_UNAVAILABLE", "Xero organisation details could not be retrieved.", 409);
    return { id: org.OrganisationID, name: org.Name, currency: org.BaseCurrency };
  }
  async getAccounts(context) {
    const body = await this.request(context, "Accounts");
    return (body?.Accounts || []).filter((row) => row.Status === "ACTIVE" && ["REVENUE", "SALES", "OTHERINCOME"].includes(row.Type) && row.Code)
      .map((row) => ({ id: row.AccountID, code: row.Code, name: row.Name }));
  }
  async getTaxRates(context) {
    const body = await this.request(context, "TaxRates");
    return (body?.TaxRates || []).filter((row) => row.Status === "ACTIVE" && row.CanApplyToRevenue === true)
      .map((row) => ({ id: row.TaxType, name: row.Name, rate: Number(row.EffectiveRate ?? row.DisplayTaxRate) }));
  }
  async getCustomer(context, id) {
    const body = await this.request(context, `Contacts/${encodeURIComponent(id)}`);
    const contact = body?.Contacts?.[0];
    if (!contact || contact.ContactID !== id || contact.ContactStatus !== "ACTIVE") throw new AccountingError("CONTACT_UNAVAILABLE", "The mapped Xero contact is missing or archived. Review it in Xero.", 409);
    return { id: contact.ContactID, reference: contact.ContactNumber || "" };
  }
  async ensureCustomer(context, customer, reference, write) {
    const body = await this.request(context, `Contacts?${new URLSearchParams({ where: `ContactNumber==${JSON.stringify(reference)}` })}`);
    const matches = body?.Contacts || [];
    if (matches.length > 1 || (matches[0] && matches[0].ContactStatus !== "ACTIVE")) throw new AccountingError("CONTACT_CONFLICT", "The source contact code is ambiguous or archived in Xero. Review the contact before retrying.", 409);
    if (matches.length === 1) return { id: matches[0].ContactID, reference };
    // Never merge by email/name: property managers can share those across customers.
    const suffix = ` [${reference.slice(-10)}]`;
    const payload = { Contacts: [{ Name: customer.name.trim().replace(/\s+/g, " ").slice(0, 255 - suffix.length) + suffix,
      ContactNumber: reference, ...(customer.email ? { EmailAddress: customer.email } : {}),
      ...(customer.phone ? { Phones: [{ PhoneType: "DEFAULT", PhoneNumber: customer.phone }] } : {}),
      ...(customer.address ? { Addresses: [{ AddressType: "POBOX", AddressLine1: customer.address }] } : {}) }] };
    // PUT is create-only; POST could update an unrelated matching name.
    const created = await write(payload, (key) => this.request(context, "Contacts", "PUT", payload, key));
    const contact = created?.Contacts?.[0];
    if (!contact?.ContactID || contact.ContactNumber !== reference) throw new AccountingError("CONTACT_RESPONSE", "Xero did not confirm the new contact identity. Retry to reconcile.", 502);
    return { id: contact.ContactID, reference };
  }
  invoicePayload(invoice, customerId, config, sourceReference) {
    return { Type: "ACCREC", Contact: { ContactID: customerId }, InvoiceNumber: invoice.number,
      Date: invoice.date, DueDate: invoice.dueDate, CurrencyCode: invoice.currency, Status: "AUTHORISED", LineAmountTypes: "Exclusive",
      Reference: `${invoice.reference} · ${sourceReference}`.slice(0, 255),
      LineItems: invoice.lines.map((line) => ({ Description: line.description, Quantity: line.quantity, UnitAmount: line.unitAmountCents / 100,
        LineAmount: line.amountCents / 100, TaxAmount: line.taxCents / 100, AccountCode: config.salesAccountCode, TaxType: config.taxMappings[line.taxTreatment] })) };
  }
  async findInvoice(context, number) {
    const body = await this.request(context, `Invoices?${new URLSearchParams({ InvoiceNumbers: number })}`);
    const matches = body?.Invoices || [];
    // Collection responses can omit lines; reconciliation needs full invoice detail.
    return matches.length === 1 ? [await this.getInvoice(context, matches[0].InvoiceID)] : matches;
  }
  async getInvoice(context, id) {
    const body = await this.request(context, `Invoices/${encodeURIComponent(id)}`);
    if (!body?.Invoices?.[0] || body.Invoices[0].InvoiceID !== id) throw new AccountingError("EXTERNAL_NOT_FOUND", "The mapped Xero invoice could not be found.", 409);
    return body.Invoices[0];
  }
  describeInvoice(record) {
    return { id: record.InvoiceID, number: record.InvoiceNumber, fingerprint: digest(JSON.stringify(comparable(record))),
      subtotalCents: cents(record.SubTotal), taxCents: cents(record.TotalTax), totalCents: cents(record.Total) };
  }
  matchesInvoice(record, payload) { return JSON.stringify(comparable(record)) === JSON.stringify(comparable(payload)); }
  assertUpdateSafe(record) {
    if (!["DRAFT", "SUBMITTED", "AUTHORISED"].includes(record.Status) || Number(record.AmountPaid || 0) > 0 || Number(record.AmountCredited || 0) > 0
      || ["Payments", "CreditNotes", "Prepayments", "Overpayments"].some((key) => record[key]?.length) || record.IsDiscounted) {
      throw new AccountingError("ACCOUNTING_STATE_CONFLICT", "This Xero invoice has payments, credits, a void or another protected accounting state. Review it in Xero; no replacement invoice was created.", 409);
    }
    if ((record.LineItems || []).some((line) => line.Tracking?.length || line.ItemCode || Number(line.DiscountRate || 0) || Number(line.DiscountAmount || 0))) {
      throw new AccountingError("EXTERNAL_EDIT_CONFLICT", "The Xero invoice has tracking, inventory or discount details that this integration does not manage. Review it in Xero before updating.", 409);
    }
  }
  async createInvoice(context, payload, key) {
    const result = await this.request(context, "Invoices", "PUT", { Invoices: [payload] }, key);
    if (!result?.Invoices?.[0]?.InvoiceID) throw new AccountingError("INVOICE_RESPONSE", "Xero did not confirm the invoice identity. Retry to reconcile.", 502);
    return result.Invoices[0];
  }
  async updateInvoice(context, record, payload, key) {
    const result = await this.request(context, `Invoices/${encodeURIComponent(record.InvoiceID)}`, "POST", { Invoices: [{ ...payload, Status: record.Status, InvoiceID: record.InvoiceID }] }, key);
    if (result?.Invoices?.[0]?.InvoiceID !== record.InvoiceID) throw new AccountingError("INVOICE_RESPONSE", "Xero did not confirm the invoice update. Retry to reconcile.", 502);
    return result.Invoices[0];
  }
}
