import express from "express";
import fs from "node:fs";
import { ensureAuthReady } from "../../server-auth.js";
import { createServerApp } from "../../server-app.js";
import { initializeWorkspaceStorage } from "../../server-workspace-storage.js";
import { createQuickBooksMock } from "../helpers/quickbooks-mock.js";

if (process.env.NODE_ENV !== "test" || process.env.ELSET_TEST_QUICKBOOKS !== "1") throw new Error("Synthetic QuickBooks server is test-only.");
initializeWorkspaceStorage();
await ensureAuthReady();
let mock = createQuickBooksMock();
const app = express();
app.post("/__quickbooks-fixture", express.json(), (req, res) => {
  if (req.body.reset) mock = createQuickBooksMock();
  for (const key of ["realm", "country", "currency", "companyName", "tokenSuffix"]) if (typeof req.body[key] === "string") mock[key] = req.body[key];
  if (req.body.taxScenario === "real-us") {
    const observed = JSON.parse(fs.readFileSync(new URL("./quickbooks-tax-sandbox-us.json", import.meta.url), "utf8"));
    Object.assign(mock, { country: observed.CompanyInfo.Country, currency: observed.Preferences.CurrencyPrefs.HomeCurrency.value,
      usingSalesTax: observed.Preferences.TaxPrefs.UsingSalesTax, taxCodes: observed.TaxCode, taxRates: observed.TaxRate });
  }
  if (req.body.taxScenario === "disabled") mock.usingSalesTax = false;
  if (req.body.taxScenario === "empty") mock.taxCodes = [];
  if (req.body.payments) mock.setPayments(req.body.payments.map(([id, amount]) => ({ id, allocations: [[mock.invoices[0].Id, amount]] })));
  if (req.body.invoicePatch && mock.invoices[0]) Object.assign(mock.invoices[0], req.body.invoicePatch);
  res.json({ customers: mock.customers, invoices: mock.invoices, calls: mock.calls.map(({ url, method }) => ({ url, method })) });
});
app.use(createServerApp({ accountingFetch: (...args) => mock.fetch(...args) }));
app.listen(Number(process.env.PORT), "127.0.0.1");
