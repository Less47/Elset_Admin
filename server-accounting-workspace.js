// The existing product's financial model is adapted here, never inside providers.
import { invoiceFinancialsFromRows } from "./server-workspace-documents.js";
import { lineTotalCentsFromScaled, gstCentsFromSubtotal } from "./server-workspace-importer.js";
import { buildDocumentReference, GST_RATE } from "./src/lib/quote-template.js";
import { invoiceDate, isQualifyingActualInvoice } from "./src/lib/invoice-account.js";
import { AccountingError } from "./server-accounting-errors.js";

export const workspaceAccountingModel = Object.freeze({ currency: "AUD", taxTreatments: [{ key: "taxable", label: "Taxable sales (10% GST)", rate: GST_RATE * 100 }] });

export function readAccountingInvoice(db, jobId) {
  return db.transaction(() => {
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    const invoice = db.prepare("SELECT * FROM invoices WHERE job_id = ? AND type = 'invoice'").get(jobId);
    if (!job || !invoice) throw new AccountingError("INVOICE_NOT_FOUND", "A saved invoice and accessible job are required.", 404);
    const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(job.customer_id);
    if (!customer) throw new AccountingError("CUSTOMER_NOT_FOUND", "The invoice customer could not be found.", 404);
    const rows = db.prepare("SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY position").all(invoice.id);
    const payments = db.prepare("SELECT amount_cents FROM payments WHERE invoice_id = ?").all(invoice.id);
    const sentCount = db.prepare("SELECT count(*) n FROM document_send_history WHERE invoice_id = ? AND document_kind = 'invoice'").get(invoice.id).n;
    const amounts = invoiceFinancialsFromRows(rows, payments);
    const actual = isQualifyingActualInvoice({ ...amounts, sentCount, metadata: JSON.parse(invoice.extra_json) });
    let runningSubtotal = 0, runningTax = 0;
    const lines = rows.map((row) => {
      const amountCents = lineTotalCentsFromScaled(row.quantity_micros, row.rate_cents);
      runningSubtotal += amountCents;
      const nextTax = gstCentsFromSubtotal(runningSubtotal);
      const taxCents = nextTax - runningTax;
      runningTax = nextTax;
      return { id: row.id, description: row.description, quantity: row.quantity_micros / 1_000_000,
        unitAmountCents: row.rate_cents, amountCents, taxCents, taxTreatment: "taxable" };
    });
    const reason = !actual ? "Only sent invoices or invoices with recorded payments can be sent to accounting."
      : !invoiceDate(invoice.issue_date) || !invoiceDate(invoice.due_date) ? "Save a valid invoice issue date and due date before syncing."
        : !lines.length || lines.some((line) => !line.description.trim() || line.quantity <= 0 || line.unitAmountCents < 0 || !Number.isSafeInteger(line.amountCents))
          ? "Save valid invoice descriptions, positive quantities and non-negative amounts before syncing."
          : "";
    return { id: invoice.id, jobId, customerId: customer.id, number: buildDocumentReference({ id: job.id, jobNumber: job.job_number }, "invoice"),
      date: invoice.issue_date, dueDate: invoice.due_date, currency: workspaceAccountingModel.currency,
      reference: `Job #${job.job_number || job.id}`, lines,
      subtotalCents: amounts.subtotalCents, taxCents: amounts.gstCents, totalCents: amounts.totalCents,
      eligible: !reason, reason,
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, address: customer.address } };
  })();
}
