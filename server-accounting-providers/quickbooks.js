import { Buffer } from "node:buffer";
import process from "node:process";
import { AccountingError, accountingInfrastructureError } from "../server-accounting-errors.js";
import { digest } from "../server-accounting-crypto.js";

export const QUICKBOOKS_SCOPE = "com.intuit.quickbooks.accounting";
export const QUICKBOOKS_MINOR_VERSION = "75";
const TOKEN = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const origins = { sandbox: "https://sandbox-quickbooks.api.intuit.com", production: "https://quickbooks.api.intuit.com" };
const cents = (value) => typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : NaN;
const review = (message, code = "ACCOUNTING_REVIEW_REQUIRED") => { throw new AccountingError(code, message, 409); };
const ref = (value) => value?.value || "";
const idOK = (id) => typeof id === "string" && /^[0-9]{1,50}$/.test(id);
const quote = (value) => `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
function comparable(invoice, homeCurrency) {
  return { customer: ref(invoice.CustomerRef), number: invoice.DocNumber, date: invoice.TxnDate, due: invoice.DueDate,
    currency: ref(invoice.CurrencyRef) || homeCurrency, taxCalculation: invoice.GlobalTaxCalculation,
    note: invoice.PrivateNote || "", lines: (invoice.Line || []).filter((line) => line.DetailType !== "SubTotalLineDetail")
      .map((line) => ({ type: line.DetailType, description: line.Description || "", amount: cents(line.Amount),
        item: ref(line.SalesItemLineDetail?.ItemRef), tax: ref(line.SalesItemLineDetail?.TaxCodeRef),
        quantity: line.SalesItemLineDetail?.Qty, unit: line.SalesItemLineDetail?.UnitPrice })) };
}

export class QuickBooksAccountingProvider {
  constructor({ env = process.env, fetchImpl = fetch } = {}) {
    this.id = "quickbooks"; this.name = "QuickBooks"; this.env = env; this.fetch = fetchImpl;
    this.requiredScopes = [QUICKBOOKS_SCOPE]; this.paymentScope = QUICKBOOKS_SCOPE;
    this.environment = env.QUICKBOOKS_ENVIRONMENT || "";
    this.multipleInvoicePayments = true;
  }
  configuration() {
    const { QUICKBOOKS_CLIENT_ID: clientId, QUICKBOOKS_CLIENT_SECRET: secret, QUICKBOOKS_REDIRECT_URI: redirect } = this.env;
    const missing = ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_REDIRECT_URI", "QUICKBOOKS_ENVIRONMENT"].filter((key) => !this.env[key]);
    if (missing.length) throw accountingInfrastructureError(`missing ${missing.join(", ")}`);
    let url;
    try { url = new URL(redirect); } catch { /* validated below */ }
    if (!Object.hasOwn(origins, this.environment) || !url || url.username || url.password || url.hash || url.search
      || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))) {
      throw accountingInfrastructureError("invalid QuickBooks environment or callback URI");
    }
    return { clientId, secret, redirect };
  }
  connect(state) {
    const { clientId, redirect } = this.configuration();
    const url = new URL("https://appcenter.intuit.com/connect/oauth2");
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", scope: QUICKBOOKS_SCOPE, state }).toString();
    return url.href;
  }
  validateCallback({ realmId }) { if (!idOK(realmId)) review("QuickBooks did not supply a valid company ID. Start Connect again.", "INVALID_REALM"); }
  async http(url, options, { token = false } = {}) {
    let response;
    try { response = await this.fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20_000) }); }
    catch { throw new AccountingError("PROVIDER_UNAVAILABLE", "QuickBooks did not confirm the request. Retry to reconcile its result safely.", 503); }
    let body;
    try { body = await response.json(); } catch { body = null; }
    if (response.status === 429) {
      const raw = response.headers.get("retry-after");
      const delay = /^\d+$/.test(raw || "") ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
      throw new AccountingError("RATE_LIMITED", "QuickBooks is limiting requests. Wait before retrying.", 429, Number.isFinite(delay) ? Math.max(1, delay) : 60);
    }
    if ([401, 403].includes(response.status) || (token && body?.error === "invalid_grant")) {
      throw new AccountingError("NEEDS_REAUTHORIZATION", "QuickBooks access needs renewal. Reconnect in Settings → Add-ons.", 409);
    }
    const codes = (body?.Fault?.Error || []).map((error) => String(error.code));
    if (response.status === 404 || codes.includes("610")) review("The mapped QuickBooks record is unavailable or deleted. Review it before retrying.", "EXTERNAL_NOT_FOUND");
    if (codes.includes("5010")) review("QuickBooks changed while this invoice was being updated. Review the latest version before retrying.", "STALE_SYNC_TOKEN");
    if (response.status >= 500) throw new AccountingError("PROVIDER_UNAVAILABLE", "QuickBooks is temporarily unavailable. Retry to reconcile safely.", 503);
    if (!response.ok || body?.Fault) throw new AccountingError("PROVIDER_VALIDATION", "QuickBooks rejected the request. Check company settings, customer details, invoice number, item and tax mappings.", 422);
    return body;
  }
  async tokenRequest(parameters) {
    const { clientId, secret } = this.configuration();
    const body = await this.http(TOKEN, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(parameters).toString() }, { token: true });
    if (!body?.access_token || !body.refresh_token || !Number.isFinite(Number(body.expires_in)) || Number(body.expires_in) <= 0) {
      throw new AccountingError("OAUTH_RESPONSE", "QuickBooks returned incomplete credentials. Connect again.", 502);
    }
    const metadata = {};
    for (const key of ["x_refresh_token_expires_in", "refresh_token_expires_in", "x_refresh_token_hard_expires_in"]) {
      if (Number.isFinite(Number(body[key])) && Number(body[key]) >= 0) metadata[key] = Date.now() + Number(body[key]) * 1000;
    }
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + Number(body.expires_in) * 1000,
      scopes: typeof body.scope === "string" ? body.scope.split(/\s+/) : [QUICKBOOKS_SCOPE], metadata };
  }
  exchangeCode(code) { return this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: this.configuration().redirect }); }
  refreshCredentials(refreshToken) { return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }); }
  revokeCredentials(refreshToken) {
    const { clientId, secret } = this.configuration();
    return this.http(REVOKE, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ token: refreshToken }) }, { token: true });
  }
  request(context, endpoint, method = "GET", payload, key) {
    this.configuration();
    if (!idOK(context.tenantId)) review("A verified QuickBooks company is required.", "INVALID_REALM");
    const url = new URL(`${origins[this.environment]}/v3/company/${context.tenantId}/${endpoint}`);
    url.searchParams.set("minorversion", QUICKBOOKS_MINOR_VERSION);
    if (key) url.searchParams.set("requestid", key);
    return this.http(url.href, { method, headers: { Authorization: `Bearer ${context.accessToken}`, Accept: "application/json",
      ...(payload ? { "Content-Type": "application/json" } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  }
  async query(context, entity, condition = "") {
    const rows = [];
    // Complete pagination or fail closed. Never silently use a partial settings list.
    for (let page = 0; page < 20; page++) {
      const query = `SELECT * FROM ${entity}${condition ? ` WHERE ${condition}` : ""} STARTPOSITION ${page * 1000 + 1} MAXRESULTS 1000`;
      const result = await this.request(context, `query?${new URLSearchParams({ query })}`);
      if (!result?.QueryResponse) review("QuickBooks returned an incomplete search response.");
      const entries = result.QueryResponse[entity] || [];
      if (!Array.isArray(entries)) review("QuickBooks returned an invalid search response.");
      rows.push(...entries);
      if (entries.length < 1000) return rows;
    }
    review("This QuickBooks result exceeds the supported query size. Contact support.");
  }
  async getOrganisation(context) {
    const body = await this.request(context, `companyinfo/${context.tenantId}`);
    const company = body?.CompanyInfo;
    // CompanyInfo.Id is the singleton record ID (commonly "1"), not the realm.
    // Access is verified by the authenticated read under the callback realm URL.
    if (!idOK(company?.Id) || !company.CompanyName) review("QuickBooks did not verify the authorised company.", "INVALID_REALM");
    const preferences = (await this.request(context, "preferences"))?.Preferences;
    const currency = ref(preferences?.CurrencyPrefs?.HomeCurrency);
    if (!currency || !company.Country) review("QuickBooks company country or home currency could not be verified.");
    this.homeCurrency = currency;
    return { id: context.tenantId, connectionId: context.tenantId, name: company.CompanyName, currency, country: company.Country,
      usingSalesTax: typeof preferences?.TaxPrefs?.UsingSalesTax === "boolean" ? preferences.TaxPrefs.UsingSalesTax : null,
      customInvoiceNumbers: preferences?.SalesFormsPrefs?.CustomTxnNumbers === true };
  }
  async getOrganisations(accessToken, { realmId } = {}) {
    this.validateCallback({ realmId });
    return [await this.getOrganisation({ accessToken, tenantId: realmId })];
  }
  async getAccounts(context) {
    return (await this.query(context, "Account", "Active = true")).filter((row) => row.Active === true && ["Income", "Other Income"].includes(row.AccountType))
      .map((row) => ({ id: row.Id, code: row.AcctNum || "", name: row.Name }));
  }
  async getItems(context) {
    return (await this.query(context, "Item", "Active = true")).filter((row) => row.Active === true && ["Service", "NonInventory"].includes(row.Type) && ref(row.IncomeAccountRef))
      .map((row) => ({ id: row.Id, name: row.FullyQualifiedName || row.Name, type: row.Type, incomeAccountId: ref(row.IncomeAccountRef) }));
  }
  async getTaxRates(context) {
    const [codes, rates] = await Promise.all([this.query(context, "TaxCode", "Active = true"), this.query(context, "TaxRate", "Active = true")]);
    const options = codes.flatMap((code) => {
      const details = code.SalesTaxRateList?.TaxRateDetail || [];
      const rate = details.length === 1 ? rates.find((row) => row.Id === ref(details[0].TaxRateRef) && row.Active === true) : null;
      return code.Active === true && rate && Number.isFinite(Number(rate.RateValue))
        ? [{ id: code.Id, name: code.Name, rate: Number(rate.RateValue), rateId: rate.Id }] : [];
    });
    if (this.env.QUICKBOOKS_TAX_DIAGNOSTICS === "1" && this.environment === "sandbox"
      && (!this.env.NODE_ENV || this.env.NODE_ENV === "development") && !this.env.FLY_APP_NAME
      && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(this.configuration().redirect).hostname)) {
      const text = (value) => typeof value === "string" ? value.slice(0, 200) : null;
      const details = (list) => (Array.isArray(list?.TaxRateDetail) ? list.TaxRateDetail : []).map((entry) => ({
        taxRateId: text(ref(entry.TaxRateRef)), name: text(entry.TaxRateRef?.name), taxType: text(entry.TaxTypeApplicable),
        order: Number.isFinite(entry.TaxOrder) ? entry.TaxOrder : null }));
      // Deliberate allowlist: never log whole provider payloads or credentials.
      console.info("[quickbooks-tax]", JSON.stringify({ taxCodeCount: codes.length,
        taxCodes: codes.map((code) => ({ id: text(code.Id), name: text(code.Name), active: typeof code.Active === "boolean" ? code.Active : null,
          sales: details(code.SalesTaxRateList), purchases: details(code.PurchaseTaxRateList) })),
        taxRates: rates.map((rate) => ({ id: text(rate.Id), name: text(rate.Name), active: typeof rate.Active === "boolean" ? rate.Active : null,
          rate: typeof rate.RateValue === "number" ? rate.RateValue : null })), optionCount: options.length }));
    }
    return options;
  }
  configurationIssue(options, model) {
    const company = options.organisation;
    if (!["AU", "Australia"].includes(company.country)) return { code: "COUNTRY_MISMATCH",
      message: `This QuickBooks company uses ${company.country} tax settings and ${company.currency}. Connect an Australian company with ${model.currency} home currency to configure GST.` };
    if (company.currency !== model.currency) return { code: "CURRENCY_MISMATCH",
      message: `This workspace invoices in ${model.currency}. Select a company with the same home currency.` };
    if (company.usingSalesTax === false) return { code: "GST_DISABLED", message: "GST is not enabled in this QuickBooks company. Enable GST in QuickBooks, then reload configuration." };
    if (model.taxTreatments.some((treatment) => !options.taxRates.some((code) => code.rate === treatment.rate))) return { code: "TAX_MAPPING",
      message: "No active QuickBooks GST tax codes were found. Check GST settings in your QuickBooks company." };
    return null;
  }
  validateConfig(input, options, model) {
    const issue = this.configurationIssue(options, model);
    if (issue) review(issue.message, issue.code);
    if (!options.organisation.customInvoiceNumbers) review("Enable custom transaction numbers in QuickBooks sales settings to preserve ELSET invoice numbers.", "INVOICE_NUMBER_SETTING");
    const item = options.items.find((row) => row.id === input.itemId);
    if (!item || !options.accounts.some((row) => row.id === item.incomeAccountId)) review("Select an active Service or Non-inventory product with an active income account.", "ITEM_MAPPING");
    const taxMappings = {}, taxRateIds = {};
    for (const treatment of model.taxTreatments) {
      const code = options.taxRates.find((row) => row.id === input.taxMappings?.[treatment.key] && row.rate === treatment.rate);
      if (!code) review(`Select a sales tax code matching ${treatment.label}. Combined tax codes are not supported.`, "TAX_MAPPING");
      taxMappings[treatment.key] = code.id; taxRateIds[treatment.key] = code.rateId;
    }
    return { itemId: item.id, incomeAccountId: item.incomeAccountId, taxMappings, taxRateIds, currency: model.currency };
  }
  async getCustomer(context, id) {
    const row = (await this.request(context, `customer/${encodeURIComponent(id)}`))?.Customer;
    if (row?.Id !== id || row.Active !== true || row.IsProject || row.Job) review("The mapped QuickBooks customer is unavailable, inactive or a sub-customer.", "CONTACT_UNAVAILABLE");
    return { id, reference: row.Notes || "" };
  }
  async ensureCustomer(context, customer, reference, write) {
    const suffix = ` [${reference.slice(-16)}]`;
    const name = customer.name.trim().replace(/\s+/g, " ").slice(0, 500 - suffix.length) + suffix;
    const notes = `ELSET:${reference}`;
    const matches = await this.query(context, "Customer", `DisplayName = ${quote(name)} AND Active IN (true,false)`);
    if (matches.length) {
      if (matches.length !== 1 || matches[0].Notes !== notes || matches[0].Active !== true || matches[0].Job || matches[0].IsProject) review("The QuickBooks customer name is already in use. No customers were merged.", "CONTACT_CONFLICT");
      return { id: matches[0].Id, reference: notes };
    }
    const payload = { DisplayName: name, Notes: notes, ...(customer.email ? { PrimaryEmailAddr: { Address: customer.email } } : {}),
      ...(customer.phone ? { PrimaryPhone: { FreeFormNumber: customer.phone } } : {}), ...(customer.address ? { BillAddr: { Line1: customer.address } } : {}) };
    const row = (await write(payload, (key) => this.request(context, "customer", "POST", payload, key)))?.Customer;
    if (!idOK(row?.Id) || row.Notes !== notes || row.DisplayName !== name) throw new AccountingError("CONTACT_RESPONSE", "QuickBooks did not confirm the customer identity. Retry to reconcile.", 502);
    return { id: row.Id, reference: notes };
  }
  invoicePayload(invoice, customerId, config, sourceReference) {
    if (invoice.number.length > 21) review("The ELSET invoice number exceeds QuickBooks' supported length.");
    return { CustomerRef: { value: customerId }, DocNumber: invoice.number, TxnDate: invoice.date, DueDate: invoice.dueDate,
      CurrencyRef: { value: invoice.currency }, PrivateNote: `${invoice.reference} | ELSET:${sourceReference}`,
      GlobalTaxCalculation: "TaxExcluded", Line: invoice.lines.map((line) => ({ DetailType: "SalesItemLineDetail", Description: line.description,
        Amount: line.amountCents / 100, SalesItemLineDetail: { ItemRef: { value: config.itemId }, TaxCodeRef: { value: config.taxMappings[line.taxTreatment] },
          Qty: line.quantity, UnitPrice: line.unitAmountCents / 100 } })) };
  }
  async findInvoice(context, number) { return this.query(context, "Invoice", `DocNumber = ${quote(number)}`); }
  async getInvoice(context, id) {
    const row = (await this.request(context, `invoice/${encodeURIComponent(id)}`))?.Invoice;
    if (row?.Id !== id) review("The mapped QuickBooks invoice could not be found.", "EXTERNAL_NOT_FOUND");
    return row;
  }
  describeInvoice(row) {
    const total = cents(row.TotalAmt), tax = cents(row.TxnTaxDetail?.TotalTax);
    return { id: row.Id, number: row.DocNumber, version: String(row.SyncToken ?? ""), fingerprint: digest(JSON.stringify({ content: comparable(row, this.homeCurrency), total, tax })),
      subtotalCents: total - tax, taxCents: tax, totalCents: total };
  }
  matchesInvoice(row, payload) { return JSON.stringify(comparable(row, this.homeCurrency)) === JSON.stringify(comparable(payload, this.homeCurrency)); }
  assertUpdateSafe(row) {
    if (row.SyncToken === undefined || !/^\d+$/.test(String(row.SyncToken)) || cents(row.Balance) !== cents(row.TotalAmt)
      || row.LinkedTxn?.length || !Number.isFinite(row.TotalAmt) || row.TotalAmt <= 0 || /^Voided/i.test(row.PrivateNote || "")) {
      review("This QuickBooks invoice has payments, credits, a void or another protected state. Review it in QuickBooks.", "ACCOUNTING_STATE_CONFLICT");
    }
    if ((row.Line || []).some((line) => !["SalesItemLineDetail", "SubTotalLineDetail"].includes(line.DetailType)
      || Object.keys(line.SalesItemLineDetail || {}).some((key) => !["ItemRef", "TaxCodeRef", "Qty", "UnitPrice", "ItemAccountRef"].includes(key)))) {
      review("QuickBooks invoice lines contain details ELSET does not manage. Review them before updating.", "EXTERNAL_EDIT_CONFLICT");
    }
  }
  async createInvoice(context, payload, key) {
    const row = (await this.request(context, "invoice", "POST", payload, key))?.Invoice;
    if (!idOK(row?.Id)) throw new AccountingError("INVOICE_RESPONSE", "QuickBooks did not confirm the invoice identity. Retry to reconcile.", 502);
    return row;
  }
  async updateInvoice(context, current, payload, key) {
    let body;
    try { body = await this.request(context, "invoice", "POST", { ...payload, Id: current.Id, SyncToken: current.SyncToken, sparse: true }, key); }
    catch (error) {
      if (error.code === "STALE_SYNC_TOKEN") {
        await this.getInvoice(context, current.Id);
        // A changed version is reviewable; never retry a write over unseen edits.
        const rejected = new AccountingError("EXTERNAL_EDIT_CONFLICT", "QuickBooks changed during the update. The latest invoice was retrieved; review it before syncing again.", 409);
        rejected.writeRejected = true;
        throw rejected;
      }
      throw error;
    }
    if (body?.Invoice?.Id !== current.Id) throw new AccountingError("INVOICE_RESPONSE", "QuickBooks did not confirm the invoice update. Retry to reconcile.", 502);
    return body.Invoice;
  }
  async getPayment(context, id) {
    const row = (await this.request(context, `payment/${encodeURIComponent(id)}`))?.Payment;
    if (row?.Id !== id) review("QuickBooks did not return the requested payment.");
    return row;
  }
  async paymentInvoiceIds(context, id) {
    let payment;
    try { payment = await this.getPayment(context, id); } catch (error) { if (error.code === "EXTERNAL_NOT_FOUND") return []; throw error; }
    return [...new Set((payment.Line || []).flatMap((line) => (line.LinkedTxn || []).filter((link) => link.TxnType === "Invoice").map((link) => link.TxnId)))];
  }
  async paymentSnapshot(context, external, source, mapping, customer) {
    if (external.Id !== mapping.external_entity_id || external.DocNumber !== mapping.external_reference || external.DocNumber !== source.number
      || ref(external.CustomerRef) !== customer?.external_entity_id || (ref(external.CurrencyRef) || this.homeCurrency) !== source.currency) review("The QuickBooks invoice identity, customer or currency differs. Review required.");
    const description = this.describeInvoice(external);
    if (["subtotalCents", "taxCents", "totalCents"].some((key) => description[key] !== source[key]) || /^Voided/i.test(external.PrivateNote || "")) review("QuickBooks invoice totals differ or the invoice is voided. ELSET amounts are unchanged.");
    const due = cents(external.Balance), paid = source.totalCents - due;
    if (!Number.isSafeInteger(due) || due < 0 || paid < 0) review("QuickBooks invoice balances are inconsistent.");
    const links = external.LinkedTxn || [];
    if (!Array.isArray(links) || links.some((link) => link.TxnType !== "Payment")) review("QuickBooks invoice has unsupported credit or other transaction allocations.");
    const ids = links.map((link) => link.TxnId);
    if (ids.length > 500 || ids.some((id) => !idOK(id)) || new Set(ids).size !== ids.length) review("QuickBooks payment references are incomplete or ambiguous.");
    const payments = [];
    for (const id of ids) {
      const payment = await this.getPayment(context, id);
      if (ref(payment.CustomerRef) !== customer?.external_entity_id || (ref(payment.CurrencyRef) || this.homeCurrency) !== source.currency
        || !/^\d{4}-\d{2}-\d{2}$/.test(payment.TxnDate || "") || !Array.isArray(payment.Line)) review("QuickBooks payment customer, currency, date or allocations are incomplete.");
      let applied = 0, allocation = 0;
      for (const line of payment.Line) {
        const amount = cents(line.Amount);
        if (!Number.isSafeInteger(amount) || amount < 0 || line.LinkedTxn?.length !== 1 || line.LinkedTxn[0].TxnType !== "Invoice" || !idOK(line.LinkedTxn[0].TxnId)) review("This QuickBooks payment includes an unsupported or ambiguous allocation, such as a credit memo.");
        applied += amount;
        if (line.LinkedTxn[0].TxnId === external.Id) allocation += amount;
      }
      const unapplied = cents(payment.UnappliedAmt), total = cents(payment.TotalAmt);
      if (!Number.isSafeInteger(total) || !Number.isSafeInteger(unapplied) || total < 0 || unapplied < 0 || applied + unapplied !== total) review("QuickBooks payment allocations do not match its total.");
      if (allocation > 0) payments.push({ id, invoiceId: external.Id, amountCents: allocation, date: payment.TxnDate, updatedAt: payment.MetaData?.LastUpdatedTime || "" });
      // Verify each resource too: a corrected allocation can retain the same invoice balance.
      if (JSON.stringify(payment) !== JSON.stringify(await this.getPayment(context, id))) throw new AccountingError("EXTERNAL_CHANGING", "QuickBooks payment changed during reconciliation. Retry shortly.", 503, 30);
    }
    return { paid, due, payments, updatedAt: external.MetaData?.LastUpdatedTime || "" };
  }
}
