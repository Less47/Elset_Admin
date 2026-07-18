export function isSqliteWorkspaceMode(mode) {
  return String(mode || "").trim().toLowerCase() === "sqlite";
}

export async function requestWorkspaceUpdate({
  fetchWithAuth,
  path,
  method = "POST",
  body,
  errorMessage = "Unable to update the customer records.",
}) {
  if (typeof fetchWithAuth !== "function") {
    throw new Error("Unable to reach the workspace API. Refresh and try again.");
  }

  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetchWithAuth(path, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload?.state) {
    throw new Error(payload?.error || errorMessage);
  }

  return payload;
}

export function requestCustomerWorkspaceUpdate(options) {
  return requestWorkspaceUpdate(options);
}

export function requestDocumentWorkspaceUpdate(options) {
  return requestWorkspaceUpdate(options);
}

export function requestInventoryWorkspaceUpdate(options) {
  return requestWorkspaceUpdate(options);
}

export function requestMaintenanceWorkspaceUpdate(options) {
  return requestWorkspaceUpdate(options);
}
