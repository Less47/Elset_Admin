import { SUPPLIER_MANUALS_BASE_URL } from "./app-support-config";

export function normalizeManualSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function compactManualSearchText(value) {
  return normalizeManualSearchText(value).replace(/\s+/g, "");
}

export function getManualSearchTokens(value) {
  return normalizeManualSearchText(value)
    .split(" ")
    .filter((token) => token.length >= 2)
    .filter(Boolean);
}

export function isSignificantManualToken(token) {
  if (!token) return false;
  if (token.length >= 4) return true;
  return /\d/.test(token) && token.length >= 3;
}

export function toAbsoluteSupplierManualUrl(url) {
  if (!url) return "";
  try {
    return new URL(url, SUPPLIER_MANUALS_BASE_URL).toString();
  } catch {
    return String(url);
  }
}

export function normalizeSupplierManuals(payload) {
  const supplierRows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.suppliers)
      ? payload.suppliers
      : [];

  return supplierRows.flatMap((supplierRow) => {
    const supplierName = String(supplierRow.supplier || supplierRow.name || "").trim();
    const supplierId = normalizeManualSearchText(supplierName).replace(/\s+/g, "-") || supplierName.toLowerCase();
    const models = Array.isArray(supplierRow.models) ? supplierRow.models : [];

    return models
      .map((model) => {
        const modelName = String(model.name || model.model || "").trim();
        const manualUrl = toAbsoluteSupplierManualUrl(model.manualUrl || model.link || model.url);
        if (!supplierName || !modelName || !manualUrl) return null;

        const modelTokens = getManualSearchTokens(modelName);
        const significantModelTokens = modelTokens.filter(isSignificantManualToken);
        const normalizedModelName = normalizeManualSearchText(modelName);
        const compactModelName = compactManualSearchText(modelName);
        const isGenericModel = significantModelTokens.length <= 1 && modelTokens.every((token) => token.length <= 3 || /^\d+$/.test(token));

        return {
          id: model.id || `${supplierId}-${compactModelName || modelName.toLowerCase()}`,
          supplierName,
          modelName,
          manualUrl,
          normalizedSupplierName: normalizeManualSearchText(supplierName),
          normalizedModelName,
          compactModelName,
          modelTokens,
          significantModelTokens,
          isGenericModel,
        };
      })
      .filter(Boolean);
  });
}

export function getJobManualSearchText(job) {
  if (!job) return "";

  return [
    job.title,
    job.description,
    job.jobAddress,
    job.notes?.map((note) => note.text).join(" "),
    job.quote?.items?.map((item) => item.description).join(" "),
    job.invoice?.items?.map((item) => item.description).join(" "),
  ].join(" ");
}

export function getSupplierManualMatchScore(manual, normalizedJobText, compactJobText) {
  if (!manual || !normalizedJobText) return 0;

  const supplierMatched = manual.normalizedSupplierName && normalizedJobText.includes(manual.normalizedSupplierName);
  const exactModelMatched = manual.normalizedModelName && normalizedJobText.includes(manual.normalizedModelName);
  const compactModelMatched = manual.compactModelName.length >= 4 && compactJobText.includes(manual.compactModelName);
  const significantTokens = manual.significantModelTokens.length ? manual.significantModelTokens : manual.modelTokens;
  const matchedTokens = significantTokens.filter((token) => normalizedJobText.includes(token));

  if (manual.isGenericModel && !supplierMatched) return 0;
  if (exactModelMatched) return 90 + (supplierMatched ? 20 : 0);
  if (compactModelMatched) return 80 + (supplierMatched ? 20 : 0);
  if (supplierMatched && matchedTokens.length > 0) return 55 + matchedTokens.length * 8;
  if (significantTokens.length >= 2 && matchedTokens.length === significantTokens.length) return 65;
  if (significantTokens.length >= 2 && matchedTokens.length >= 2) return 45 + matchedTokens.length * 6;
  if (!manual.isGenericModel && significantTokens.length === 1 && matchedTokens.length === 1) return 38;

  return 0;
}

export function findSupplierManualMatches(job, manuals, limit = 5) {
  if (!job || !Array.isArray(manuals) || manuals.length === 0) return [];

  const normalizedJobText = normalizeManualSearchText(getJobManualSearchText(job));
  const compactJobText = normalizedJobText.replace(/\s+/g, "");
  if (!normalizedJobText) return [];

  return manuals
    .map((manual) => ({
      ...manual,
      score: getSupplierManualMatchScore(manual, normalizedJobText, compactJobText),
    }))
    .filter((manual) => manual.score >= 38)
    .sort((a, b) => b.score - a.score || a.supplierName.localeCompare(b.supplierName) || a.modelName.localeCompare(b.modelName))
    .slice(0, limit);
}
