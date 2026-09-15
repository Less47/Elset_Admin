import { invoiceFinancialsFromRows, WorkspaceDocumentError } from "./server-workspace-documents.js";
import { summarizeInvoiceAccount } from "./src/lib/invoice-account.js";
import { buildDocumentReference } from "./src/lib/quote-template.js";

function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.invoice_id)) groups.set(row.invoice_id, []);
    groups.get(row.invoice_id).push(row);
  }
  return groups;
}

export function getCustomerAccountSummary(db, customerId, options) {
  // Read transaction: summary and breakdown see the same committed data.
  return db.transaction(() => {
    if (!db.prepare("SELECT id FROM customers WHERE id = ?").get(customerId)) throw new WorkspaceDocumentError("Customer not found.", 404);
    const invoices = db.prepare(`SELECT i.id, i.job_id, i.issue_date, i.due_date, i.extra_json, j.job_number
      FROM invoices i JOIN jobs j ON j.id = i.job_id WHERE j.customer_id = ?`).all(customerId);
    const items = groupRows(db.prepare(`SELECT l.invoice_id, l.quantity_micros, l.rate_cents
      FROM invoice_line_items l JOIN invoices i ON i.id = l.invoice_id JOIN jobs j ON j.id = i.job_id
      WHERE j.customer_id = ?`).all(customerId));
    const payments = groupRows(db.prepare(`SELECT p.invoice_id, p.amount_cents FROM payments p
      JOIN invoices i ON i.id = p.invoice_id JOIN jobs j ON j.id = i.job_id WHERE j.customer_id = ?`).all(customerId));
    const sent = new Map(db.prepare(`SELECT h.invoice_id, COUNT(*) AS count FROM document_send_history h
      JOIN invoices i ON i.id = h.invoice_id JOIN jobs j ON j.id = i.job_id
      WHERE j.customer_id = ? AND h.document_kind = 'invoice' GROUP BY h.invoice_id`).all(customerId).map((row) => [row.invoice_id, row.count]));
    const records = invoices.map((invoice) => {
      const metadata = JSON.parse(invoice.extra_json || "{}");
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Invalid invoice metadata.");
      const paymentRows = payments.get(invoice.id) || [];
      return { customerId, invoiceId: invoice.id, jobId: invoice.job_id,
        invoiceNumber: buildDocumentReference({ id: invoice.job_id, jobNumber: invoice.job_number }, "invoice"),
        issueDate: invoice.issue_date, dueDate: invoice.due_date, metadata,
        ...invoiceFinancialsFromRows(items.get(invoice.id) || [], paymentRows), paymentCount: paymentRows.length, sentCount: sent.get(invoice.id) || 0 };
    });
    return summarizeInvoiceAccount(customerId, records, options);
  })();
}
