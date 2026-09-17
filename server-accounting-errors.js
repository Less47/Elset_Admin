export class AccountingError extends Error {
  constructor(code, message, statusCode = 400, retryAfter = 0) {
    super(message);
    this.name = "AccountingError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}
export const ACCOUNTING_UNAVAILABLE_MESSAGE = "Accounting integration is temporarily unavailable. Please contact support.";

export function accountingInfrastructureError(diagnostic, code = "SERVER_CONFIGURATION", statusCode = 503) {
  // Operator-only diagnostics must contain fixed descriptions/variable names, never values or raw errors.
  console.error(`[accounting] ${diagnostic}`);
  return new AccountingError(code, ACCOUNTING_UNAVAILABLE_MESSAGE, statusCode);
}

export function customerAccountingMessage(message = "") {
  // Older versions may have persisted infrastructure instructions in safe_error_message.
  return /ACCOUNTING_INTEGRATION_ENCRYPTION_KEY|XERO_CLIENT_(?:ID|SECRET)|XERO_REDIRECT_URI|encryption key|Xero client ID, secret/i.test(message)
    ? ACCOUNTING_UNAVAILABLE_MESSAGE : message;
}

export function safeAccountingError(error) {
  if (!(error instanceof AccountingError)) return new AccountingError("INTEGRATION_ERROR", "Accounting integration could not complete this request. Try again or contact your administrator.", 500);
  const message = ["SERVER_CONFIGURATION", "CREDENTIAL_UNAVAILABLE"].includes(error.code)
    ? ACCOUNTING_UNAVAILABLE_MESSAGE : customerAccountingMessage(error.message);
  return message === error.message ? error : new AccountingError(error.code, message, error.statusCode, error.retryAfter);
}
