export async function maintenanceServiceRequest(fetchWithAuth, path, options = {}) {
  const response = await fetchWithAuth(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || "Unable to access the maintenance service report."), payload);
  return payload;
}

export async function openMaintenanceServicePdf(fetchWithAuth, path, download = false) {
  const preview = download ? null : window.open("", "_blank");
  if (preview) { preview.opener = null; preview.document.title = "Preparing service report"; }
  try {
    const response = await fetchWithAuth(`${path}/report.pdf${download ? "?download=1" : ""}`);
    if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || "Unable to prepare the service report PDF."); }
    const url = URL.createObjectURL(await response.blob());
    if (download) {
      const link = document.createElement("a"); link.href = url;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "maintenance-service-report.pdf";
      link.click();
    } else if (preview) preview.location.href = url;
    else { const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener"; link.click(); }
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { preview?.close(); throw error; }
}
