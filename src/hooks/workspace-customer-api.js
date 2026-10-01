export async function requestWorkspaceUpdate({
  fetchWithAuth,
  path,
  method = "POST",
  body,
  onRecovery,
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

  let response;
  try {
    response = await fetchWithAuth(path, options);
  } catch (error) {
    await recoverWorkspace(error);
    throw error;
  }
  const payload = await response.json().catch(() => ({}));

  const hasDelta = payload?.ok === true && payload.delta && typeof payload.delta === "object" && !Array.isArray(payload.delta);
  if (!response.ok || !(payload?.state || hasDelta)) {
    const error = new Error(payload?.error || errorMessage);
    error.status = response.status;
    error.code = payload?.code;
    if (response.status >= 500 || response.ok) await recoverWorkspace(error);
    throw error;
  }

  return payload;

  async function recoverWorkspace(error) {
    if (method === "GET" || typeof onRecovery !== "function") return;
    try {
      const recovered = await fetchWithAuth("/api/app-state", { method: "GET" });
      const authoritative = await recovered.json();
      if (!recovered.ok || !authoritative.state) return;
      onRecovery(authoritative.state);
      error.recovered = true;
    } catch { /* Keep the original write error; never retry an uncertain write. */ }
  }
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

export function requestStaffWorkspaceUpdate(options) {
  return requestWorkspaceUpdate(options);
}

export function requestSettingsWorkspaceUpdate(options) {
  return requestWorkspaceUpdate(options);
}

export function requestServiceM8ImportUpdate(options) {
  return requestWorkspaceUpdate({
    errorMessage: "Unable to import ServiceM8 data.",
    ...options,
  });
}

export function requestWorkspaceRestoreUpdate(options) {
  return requestWorkspaceUpdate({
    errorMessage: "Unable to restore the workspace backup.",
    ...options,
  });
}
