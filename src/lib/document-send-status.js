export function documentSendErrorMessage(type, code) {
  const label = type === "invoice" ? "Invoice" : "Quote";
  switch (code) {
    case "ATTACHMENT_FAILED": return `Could not prepare ${label.toLowerCase()} attachment. Please try again.`;
    case "EMAIL_NOT_CONFIGURED": return `${label} could not be sent. Ask an administrator to check the email settings.`;
    case "RECIPIENT_REJECTED": return `${label} could not be sent. The email service did not accept the recipient. Check the email address and try again.`;
    case "NO_RECIPIENT": return `Add a billing or customer email address before sending the ${label.toLowerCase()}.`;
    case "SEND_UNCONFIRMED": return `Could not confirm whether the ${label.toLowerCase()} was sent. Check before retrying.`;
    default: return `${label} could not be sent. Please try again.`;
  }
}
