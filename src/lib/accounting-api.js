export async function accountingRequest(fetchWithAuth, path, { method = "GET", body } = {}) {
  const response = await fetchWithAuth(path, { method, cache: "no-store", headers: { "Content-Type": "application/json", "X-Accounting-Request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.result) {
    const error = new Error(payload.error || "Accounting could not be reached. Try again.");
    error.code = payload.code;
    throw error;
  }
  return payload.result;
}
