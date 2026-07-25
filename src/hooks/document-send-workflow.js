export async function sendDocumentAndPersistHistory({
  sendEmail,
  buildHistoryEntry,
  persistHistory,
  onSuccess,
  onError,
}) {
  try {
    const payload = await sendEmail();
    const historyEntry = buildHistoryEntry(payload);
    const persisted = await persistHistory({ payload, historyEntry });

    if (!persisted) return false;

    if (typeof onSuccess === "function") {
      onSuccess({ payload, historyEntry });
    }

    return true;
  } catch (error) {
    if (typeof onError === "function") {
      onError(error);
    }
    return false;
  }
}
