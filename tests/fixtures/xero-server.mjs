import express from "express";
import { ensureAuthReady } from "../../server-auth.js";
import { createServerApp } from "../../server-app.js";
import { initializeWorkspaceStorage } from "../../server-workspace-storage.js";
import { createXeroMock } from "../helpers/xero-mock.js";

if (process.env.NODE_ENV !== "test" || process.env.ELSET_TEST_XERO !== "1") throw new Error("Synthetic Xero server is test-only.");
initializeWorkspaceStorage();
await ensureAuthReady();
let mock = createXeroMock();
const configuredEnvironment = Object.fromEntries(["XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_REDIRECT_URI", "ACCOUNTING_INTEGRATION_ENCRYPTION_KEY"].map((name) => [name, process.env[name]]));
const app = express();
app.use(express.json());
app.post("/__xero-fixture", (req, res) => {
  if (req.body.reset) { mock = createXeroMock(); Object.assign(process.env, configuredEnvironment); }
  if (Object.hasOwn(configuredEnvironment, req.body.missingConfiguration)) delete process.env[req.body.missingConfiguration];
  if (req.body.loseNextInvoiceResponse) mock.loseNextInvoiceResponse = true;
  if (req.body.failNext) mock.failNext = req.body.failNext;
  if (req.body.organisations) mock.organisations = req.body.organisations;
  if (req.body.paid && mock.invoices[0]) mock.invoices[0].AmountPaid = 1;
  res.json({ contacts: mock.contacts, invoices: mock.invoices, calls: mock.calls.map(({ url, method }) => ({ url, method })) });
});
app.use(createServerApp({ accountingFetch: (...args) => mock.fetch(...args) }));
app.listen(Number(process.env.PORT), "127.0.0.1");
