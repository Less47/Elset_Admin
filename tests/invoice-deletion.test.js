import assert from "node:assert/strict";
import test from "node:test";
import { invoiceDeletionRestriction, invoiceHasBeenSent } from "../src/lib/invoice-deletion.js";

test("invoice deletion preserves historical sent, payment and receipt protections", () => {
  assert.equal(invoiceHasBeenSent({ sentHistory: [{ sentAt: "2026-01-01" }] }), true);
  for (const invoice of [
    { payments: [{ amount: 0 }] }, { payments: [{ amount: 100 }] }, { paidAmount: 100 }, { paymentStatus: "Paid" },
    { sentHistory: [{ emailPurpose: "paid-receipt" }] }, { sentHistory: [{ stampText: "PART PAYMENT" }] },
    { sentHistory: [{ documentSnapshot: { payments: [{ amount: 30 }] } }] },
  ]) assert.match(invoiceDeletionRestriction(invoice), /payment/i);
  assert.equal(invoiceDeletionRestriction({ sentHistory: [null] }), "");
});
