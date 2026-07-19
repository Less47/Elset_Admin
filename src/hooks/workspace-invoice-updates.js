export const sqliteInvoiceUpdateFields = ["issueDate", "dueDate", "notes", "paymentNotes"];

export function getSupportedInvoiceUpdateKeys(updates) {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) return [];
  return sqliteInvoiceUpdateFields.filter((field) => Object.prototype.hasOwnProperty.call(updates, field));
}
