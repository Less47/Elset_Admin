import { XeroAccountingProvider } from "./server-accounting-providers/xero.js";
import { AccountingError } from "./server-accounting-errors.js";

// Providers translate neutral customers/invoices/configuration into their own API.
// Service owns credentials, locks, mappings, operations and audit history.
export function getAccountingProvider(id, options = {}) {
  if (id === "xero") return new XeroAccountingProvider(options);
  throw new AccountingError("UNKNOWN_PROVIDER", "Unknown accounting provider.", 404);
}
