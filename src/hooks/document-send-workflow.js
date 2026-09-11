export async function sendDocumentAndPersistHistory({
  sendEmail,
  buildHistoryEntry,
  persistHistory,
  onSuccess,
  onError,
}) {
  let payload;
  try {
    payload = await sendEmail();
    if (payload?.ok !== true) throw Object.assign(new Error("Email acceptance was not confirmed."), { code: "SEND_UNCONFIRMED" });
  } catch (error) {
    if (typeof onError === "function") onError(error);
    return { status: "failed", code: error?.code || "SEND_FAILED" };
  }

  try {
    const historyEntry = buildHistoryEntry(payload);
    const persisted = await persistHistory({ payload, historyEntry });
    if (persisted && typeof onSuccess === "function") {
      onSuccess({ payload, historyEntry });
    }
    return { status: "sent", payload, historySaved: Boolean(persisted) };
  } catch {
    // The email was already accepted. A local save failure must not invite a resend.
    return { status: "sent", payload, historySaved: false };
  }
}
