import crypto from "node:crypto";

// Synthetic HTTP boundary: never forwards requests to Xero or another network.
export function createXeroMock() {
  const mock = { calls: [], contacts: [], invoices: [], payments: [], scopes: "offline_access accounting.contacts accounting.invoices accounting.settings.read accounting.payments.read", refreshes: 0, failNext: null, loseNextInvoiceResponse: false,
    organisations: [{ id: "connection-demo", tenantId: "tenant-demo", tenantName: "Demo Company (AU)", tenantType: "ORGANISATION" }],
    accounts: [{ AccountID: "sales-id", Code: "410", Name: "Service sales", Type: "REVENUE", Status: "ACTIVE" }, { AccountID: "bank-id", Code: "090", Name: "Bank", Type: "BANK", Status: "ACTIVE" }],
    taxRates: [{ TaxType: "OUTPUT", Name: "GST on Income", EffectiveRate: 10, CanApplyToRevenue: true, Status: "ACTIVE" }, { TaxType: "EXEMPTOUTPUT", Name: "GST Free Income", EffectiveRate: 0, CanApplyToRevenue: true, Status: "ACTIVE" }, { TaxType: "INPUT", Name: "Expense GST", EffectiveRate: 10, CanApplyToRevenue: false, Status: "ACTIVE" }] };
  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  mock.fetch = async (urlInput, options = {}) => {
    const url = new URL(urlInput), method = options.method || "GET";
    const body = options.body && options.headers?.["Content-Type"] === "application/json" ? JSON.parse(options.body) : options.body;
    mock.calls.push({ url: url.href, method, body, headers: options.headers });
    if (mock.failNext && url.pathname.includes(mock.failNext.path)) {
      const failure = mock.failNext; mock.failNext = null;
      if (failure.wait) await failure.wait;
      if (failure.throw) throw new Error("Synthetic network loss");
      return json(failure.body || { error: "fixture" }, failure.status || 503, failure.headers);
    }
    if (url.pathname === "/connect/token") {
      const input = new URLSearchParams(body);
      if (input.get("grant_type") === "refresh_token") mock.refreshes++;
      return json({ access_token: `fixture-access-${mock.refreshes}`, refresh_token: `fixture-refresh-${mock.refreshes}`, expires_in: 1800,
        scope: mock.scopes });
    }
    if (url.pathname === "/connections") return json(mock.organisations);
    if (url.pathname.startsWith("/connections/") && method === "DELETE") return new Response(null, { status: 204 });
    if (!url.pathname.startsWith("/api.xro/2.0/")) throw new Error(`Unexpected fixture request: ${url.pathname}`);
    if (!mock.organisations.some((item) => item.tenantId === options.headers["xero-tenant-id"])) return json({}, 403);
    const endpoint = url.pathname.slice("/api.xro/2.0/".length);
    if (endpoint === "Organisation") return json({ Organisations: [{ OrganisationID: options.headers["xero-tenant-id"], Name: "Demo Company (AU)", BaseCurrency: "AUD" }] });
    if (endpoint === "Accounts") return json({ Accounts: mock.accounts });
    if (endpoint === "TaxRates") return json({ TaxRates: mock.taxRates });
    if (endpoint.startsWith("Payments/") && method === "GET") return json({ Payments: mock.payments.filter((payment) => payment.PaymentID === endpoint.split("/")[1]) });
    if (endpoint.startsWith("Contacts")) {
      if (method === "GET") {
        const id = endpoint.split("/")[1];
        if (id) return mock.contacts.some((item) => item.ContactID === id) ? json({ Contacts: mock.contacts.filter((item) => item.ContactID === id) }) : json({}, 404);
        const ref = JSON.parse((url.searchParams.get("where") || "").split("==")[1]);
        return json({ Contacts: mock.contacts.filter((item) => item.ContactNumber === ref) });
      }
      const contact = body.Contacts[0];
      if (mock.contacts.some((item) => item.ContactNumber === contact.ContactNumber || item.Name === contact.Name)) return json({ error: "duplicate" }, 400);
      const created = { ...contact, ContactID: crypto.randomUUID(), ContactStatus: "ACTIVE" };
      mock.contacts.push(created);
      return json({ Contacts: [created] });
    }
    if (endpoint.startsWith("Invoices")) {
      const id = endpoint.split("/")[1];
      if (method === "GET") return json({ Invoices: mock.invoices.filter((item) => id ? item.InvoiceID === id : item.InvoiceNumber === url.searchParams.get("InvoiceNumbers")) });
      const data = body.Invoices[0];
      if (!id && mock.invoices.some((item) => item.InvoiceNumber === data.InvoiceNumber)) return json({ error: "number already exists" }, 400);
      const subtotal = data.LineItems.reduce((sum, item) => sum + Math.round(item.LineAmount * 100), 0) / 100;
      const tax = data.LineItems.reduce((sum, item) => sum + Math.round(item.TaxAmount * 100), 0) / 100;
      const record = { ...data, InvoiceID: id || crypto.randomUUID(), SubTotal: subtotal, TotalTax: tax, Total: Math.round((subtotal + tax) * 100) / 100, AmountPaid: 0, AmountDue: Math.round((subtotal + tax) * 100) / 100, Payments: [], AmountCredited: 0 };
      if (id) mock.invoices[mock.invoices.findIndex((item) => item.InvoiceID === id)] = record;
      else mock.invoices.push(record);
      if (mock.loseNextInvoiceResponse) { mock.loseNextInvoiceResponse = false; throw new Error("Response lost after accepted write"); }
      return json({ Invoices: [record] });
    }
    throw new Error(`Unsupported fixture endpoint: ${endpoint}`);
  };
  return mock;
}
