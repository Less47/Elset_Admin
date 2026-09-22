// Synthetic HTTP boundary. No request ever leaves this fixture.
export function createQuickBooksMock() {
  const mock = { calls: [], customers: [], invoices: [], payments: [], refreshes: 0, failNext: null, loseInvoiceResponse: false, loseItemResponse: false, staleNext: false,
    realm: "123456789", country: "AU", currency: "AUD", companyName: "Fixture AU company", tokenSuffix: "", customNumbers: true, usingSalesTax: true,
    accounts: [{ Id: "10", Name: "Service income", AccountType: "Income", Active: true }],
    items: [{ Id: "20", Name: "Service", Type: "Service", Active: true, IncomeAccountRef: { value: "10" } }],
    taxCodes: [{ Id: "30", Name: "GST", Active: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "31" } }] } }],
    taxRates: [{ Id: "31", Name: "GST sales", RateValue: 10, Active: true }] };
  let sequence = 100;
  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  const fault = (code) => json({ Fault: { Error: [{ code, Message: "Never expose provider-private data" }] } }, 400);
  const requests = new Map();
  mock.fetch = async (input, options = {}) => {
    const url = new URL(input), method = options.method || "GET";
    const body = options.headers?.["Content-Type"] === "application/json" ? JSON.parse(options.body) : options.body;
    mock.calls.push({ url: url.href, method, body, headers: options.headers });
    if (mock.failNext && url.pathname.includes(mock.failNext.path)) {
      const failure = mock.failNext; mock.failNext = null;
      if (failure.wait) await failure.wait;
      if (failure.throw) throw new Error("Fixture network loss");
      return json(failure.body || {}, failure.status || 503, failure.headers);
    }
    if (url.pathname.endsWith("/tokens/bearer")) {
      if (new URLSearchParams(body).get("grant_type") === "refresh_token") mock.refreshes++;
      return json({ access_token: `fixture-access-${mock.refreshes}${mock.tokenSuffix}`, refresh_token: `fixture-refresh-${mock.refreshes}${mock.tokenSuffix}`, expires_in: 3600,
        x_refresh_token_expires_in: 8640000, x_refresh_token_hard_expires_in: 157680000 });
    }
    if (url.pathname.endsWith("/tokens/revoke")) return json({});
    if (!url.pathname.startsWith(`/v3/company/${mock.realm}/`)) return json({}, 403);
    if (url.searchParams.get("minorversion") !== "75") throw new Error("Missing fixture minorversion");
    const endpoint = url.pathname.split(`/v3/company/${mock.realm}/`)[1];
    if (endpoint === `companyinfo/${mock.realm}`) return json({ CompanyInfo: { Id: "1", CompanyName: mock.companyName, Country: mock.country } });
    if (endpoint === "preferences") return json({ Preferences: { CurrencyPrefs: { HomeCurrency: { value: mock.currency } }, SalesFormsPrefs: { CustomTxnNumbers: mock.customNumbers }, TaxPrefs: { UsingSalesTax: mock.usingSalesTax } } });
    const lists = { Customer: mock.customers, Invoice: mock.invoices, Payment: mock.payments, Account: mock.accounts, Item: mock.items, TaxCode: mock.taxCodes, TaxRate: mock.taxRates };
    if (endpoint === "query") {
      const query = url.searchParams.get("query"), entity = query.match(/FROM (\w+)/)?.[1];
      let values = lists[entity];
      if (!values) throw new Error(`Unknown fixture query ${query}`);
      const criterion = query.match(/(?:DisplayName|DocNumber) = '((?:\\.|[^'])*)'/);
      if (criterion) { const value = criterion[1].replaceAll("\\'", "'").replaceAll("\\\\", "\\"); values = values.filter((row) => (entity === "Customer" ? row.DisplayName : row.DocNumber) === value); }
      const offset = Number(query.match(/STARTPOSITION (\d+)/)?.[1] || 1) - 1;
      return json({ QueryResponse: { [entity]: values.slice(offset, offset + 1000) } });
    }
    const [kind, id] = endpoint.split("/"), entity = kind[0].toUpperCase() + kind.slice(1);
    const values = lists[entity];
    if (!values) throw new Error(`Unknown fixture request ${endpoint}`);
    if (method === "GET") { const row = values.find((row) => row.Id === id); return row ? json({ [entity]: row }) : fault("610"); }
    if (method !== "POST" || !["Customer", "Invoice", "Item"].includes(entity)) throw new Error("Unsupported fixture write");
    const requestId = url.searchParams.get("requestid");
    if (!requestId) throw new Error("Fixture requires durable request ID");
    if (requests.has(requestId)) return json(requests.get(requestId));
    if (entity === "Item") {
      if (body.Id || body.Type !== "Service" || body.Active !== true || !mock.accounts.some(account => account.Id === body.IncomeAccountRef?.value && account.Active && account.AccountType === "Income")) throw new Error("Unsafe fixture item write");
      if (mock.items.some(row => row.Name.trim().toLowerCase() === body.Name.trim().toLowerCase())) return fault("6240");
      const row = { ...body, Id: String(sequence++), SyncToken: "0" };
      mock.items.push(row); requests.set(requestId, { Item: row });
      if (mock.loseItemResponse) { mock.loseItemResponse = false; throw new Error("Fixture item accepted; response lost"); }
      return json({ Item: row });
    }
    if (entity === "Customer") {
      if (mock.customers.some((row) => row.DisplayName === body.DisplayName)) return fault("6240");
      const row = { ...body, Id: String(sequence++), SyncToken: "0", Active: true };
      mock.customers.push(row); requests.set(requestId, { Customer: row }); return json({ Customer: row });
    }
    const previous = body.Id ? mock.invoices.find((row) => row.Id === body.Id) : null;
    if (mock.staleNext || (previous && previous.SyncToken !== body.SyncToken)) { mock.staleNext = false; if (previous) previous.SyncToken = String(Number(previous.SyncToken) + 1); return fault("5010"); }
    if (!previous && mock.invoices.some((row) => row.DocNumber === body.DocNumber)) return fault("6140");
    const subtotalCents = body.Line.reduce((sum, line) => sum + Math.round(line.Amount * 100), 0);
    const tax = Math.round(subtotalCents * 0.1) / 100, total = subtotalCents / 100 + tax;
    const row = { ...previous, ...body, sparse: false, Id: previous?.Id || String(sequence++), SyncToken: String(previous ? Number(previous.SyncToken) + 1 : 0),
      TxnTaxDetail: { TotalTax: tax }, TotalAmt: Math.round(total * 100) / 100, Balance: Math.round(total * 100) / 100, LinkedTxn: [], MetaData: { LastUpdatedTime: "2026-09-18T00:00:00Z" } };
    if (previous) Object.assign(previous, row); else mock.invoices.push(row);
    requests.set(requestId, { Invoice: row });
    if (mock.loseInvoiceResponse) { mock.loseInvoiceResponse = false; throw new Error("Fixture write accepted; response lost"); }
    return json({ Invoice: row });
  };
  mock.setPayments = (entries) => {
    mock.payments = entries.map(({ id, allocations, unapplied = 0, ...rest }) => ({ Id: id, SyncToken: "1", CustomerRef: mock.invoices[0].CustomerRef,
      TxnDate: "2026-09-18", CurrencyRef: { value: mock.currency }, UnappliedAmt: unapplied,
      TotalAmt: allocations.reduce((sum, [, amount]) => sum + amount, unapplied),
      Line: allocations.map(([invoiceId, amount]) => ({ Amount: amount, LinkedTxn: [{ TxnId: invoiceId, TxnType: "Invoice" }] })),
      MetaData: { LastUpdatedTime: "2026-09-18T01:00:00Z" }, ...rest }));
    for (const invoice of mock.invoices) {
      invoice.LinkedTxn = mock.payments.filter((payment) => payment.Line.some((line) => line.LinkedTxn.some((link) => link.TxnId === invoice.Id)))
        .map((payment) => ({ TxnId: payment.Id, TxnType: "Payment" }));
      const paid = mock.payments.reduce((sum, payment) => sum + payment.Line.filter((line) => line.LinkedTxn[0].TxnId === invoice.Id).reduce((sum, line) => sum + line.Amount, 0), 0);
      invoice.Balance = Math.round((invoice.TotalAmt - paid) * 100) / 100;
    }
  };
  return mock;
}
