import { lineTotalCentsFromScaled, gstCentsFromSubtotal } from "./server-workspace-financials.js";

export function countTable(db, tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function sumDocumentLines(db, tableName, foreignKeyName) {
  return db.prepare(`SELECT quantity_micros, rate_cents FROM ${tableName} ORDER BY ${foreignKeyName}, position`).all()
    .reduce((sum, row) => sum + lineTotalCentsFromScaled(row.quantity_micros, row.rate_cents), 0);
}

function groupDocumentTotals(db, documentTable, lineTable, documentIdColumn) {
  const documents = db.prepare(`SELECT id FROM ${documentTable}`).all();
  const lineStatement = db.prepare(`SELECT quantity_micros, rate_cents FROM ${lineTable} WHERE ${documentIdColumn} = ?`);

  return documents.reduce((sum, document) => {
    const subtotal = lineStatement.all(document.id).reduce(
      (lineSum, row) => lineSum + lineTotalCentsFromScaled(row.quantity_micros, row.rate_cents),
      0
    );
    return sum + subtotal + gstCentsFromSubtotal(subtotal);
  }, 0);
}

export function summarizeWorkspaceDb(db) {
  const serviceCounts = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='maintenance_service_reports'").get()
    ? { maintenanceServiceReports: countTable(db, "maintenance_service_reports"), maintenanceServiceResults: countTable(db, "maintenance_service_checklist_results"),
      maintenanceServiceDefects: countTable(db, "maintenance_service_defects"), maintenanceServiceSends: countTable(db, "maintenance_service_send_history") } : {};
  const contactCounts = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='contacts'").get()
    ? { contacts: countTable(db, "contacts"), customerContactAssignments: countTable(db, "customer_contact_links"), siteContactAssignments: countTable(db, "site_contact_links") } : {};
  const invoiceTotalsById = new Map();
  const invoices = db.prepare("SELECT id FROM invoices").all();
  const invoiceLines = db.prepare("SELECT quantity_micros, rate_cents FROM invoice_line_items WHERE invoice_id = ?");
  const invoicePayments = db.prepare("SELECT amount_cents FROM payments WHERE invoice_id = ?");

  for (const invoice of invoices) {
    const subtotalCents = invoiceLines.all(invoice.id).reduce(
      (sum, row) => sum + lineTotalCentsFromScaled(row.quantity_micros, row.rate_cents),
      0
    );
    const totalCents = subtotalCents + gstCentsFromSubtotal(subtotalCents);
    const paidCents = invoicePayments.all(invoice.id).reduce((sum, row) => sum + Math.max(Number(row.amount_cents || 0), 0), 0);
    invoiceTotalsById.set(invoice.id, {
      totalCents,
      paidCents,
      balanceCents: Math.max(totalCents - paidCents, 0),
    });
  }

  return {
    counts: {
      ...contactCounts,
      ...serviceCounts,
      staff: countTable(db, "staff"),
      customers: countTable(db, "customers"),
      customerSites: countTable(db, "sites"),
      customerSiteAssets: countTable(db, "site_assets"),
      customerAccessNotes: countTable(db, "site_access_notes"),
      jobs: countTable(db, "jobs"),
      jobNotes: countTable(db, "job_notes"),
      jobAttachments: countTable(db, "job_attachments"),
      quotes: countTable(db, "quotes"),
      quoteLineItems: countTable(db, "quote_line_items"),
      invoices: countTable(db, "invoices"),
      invoiceLineItems: countTable(db, "invoice_line_items"),
      payments: countTable(db, "payments"),
      quoteSentHistory: db.prepare("SELECT COUNT(*) AS count FROM document_send_history WHERE document_kind = 'quote'").get().count,
      invoiceSentHistory: db.prepare("SELECT COUNT(*) AS count FROM document_send_history WHERE document_kind = 'invoice'").get().count,
      inventoryItems: countTable(db, "inventory_items"),
      priceListItems: countTable(db, "price_list_items"),
      maintenancePlans: countTable(db, "maintenance_plans"),
      maintenanceChecklistItems: countTable(db, "maintenance_checklist_items"),
      deletedJobs: db.prepare("SELECT COUNT(*) AS count FROM deleted_records WHERE kind = 'job'").get().count,
      deletedCustomers: db.prepare("SELECT COUNT(*) AS count FROM deleted_records WHERE kind = 'customer'").get().count,
      deletedInvoices: countTable(db, "deleted_invoices"),
    },
    financials: {
      quoteTotalsCents: groupDocumentTotals(db, "quotes", "quote_line_items", "quote_id"),
      invoiceTotalsCents: [...invoiceTotalsById.values()].reduce((sum, invoice) => sum + invoice.totalCents, 0),
      paymentTotalsCents: [...invoiceTotalsById.values()].reduce((sum, invoice) => sum + invoice.paidCents, 0),
      outstandingBalanceCents: [...invoiceTotalsById.values()].reduce((sum, invoice) => sum + invoice.balanceCents, 0),
      quoteSubtotalCents: sumDocumentLines(db, "quote_line_items", "quote_id"),
      invoiceSubtotalCents: sumDocumentLines(db, "invoice_line_items", "invoice_id"),
    },
  };
}

