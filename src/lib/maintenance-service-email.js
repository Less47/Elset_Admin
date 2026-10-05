import { parseEmailRecipients } from "./document-email.js";

export function maintenanceServiceEmailDraft(report) {
  const snapshot = report.snapshot;
  return { to: parseEmailRecipients(snapshot.billingContact?.email || snapshot.customerEmail || "").addresses, cc: [], bcc: [],
    subject: `ELSET Maintenance Service Report – ${snapshot.siteAddress.replace(/[\r\n]+/g, " ")}`,
    message: [`Dear ${snapshot.billingContact?.name || snapshot.contactName || snapshot.customerName || "Customer"},`, "",
      `Please find attached the maintenance service report for the completed service at ${snapshot.siteAddress}.`,
      ...(report.defects.length ? ["", "One or more defects requiring attention were identified during the service. Details are included in the attached report."] : []),
      "", "Please let us know if you have any questions.", "", "Regards,", "ELSET PTY LTD"].join("\n") };
}
