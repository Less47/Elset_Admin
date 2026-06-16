import fs from "fs";
import path from "path";
import crypto from "crypto";
import express from "express";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { fileURLToPath } from "url";
import { generateDocumentPdf } from "./quote-pdf.js";
import {
  applyServiceM8ImportPlan,
  buildAndApplyServiceM8Import,
  previewServiceM8Import,
} from "./server-servicem8-importer.js";
import {
  auth,
  getAuthBackupUsers,
  getManagedUserAccounts,
  getRequestAuthSession,
  restoreAuthBackup,
  saveManagedUserAccount,
  syncManagedUserNamesWithStaff,
  verifyUserPassword,
} from "./server-auth.js";
import {
  ADMIN_EMAIL,
  buildDocumentEmail,
  normalizeInvoiceTemplate,
  normalizeQuoteTemplate,
} from "./src/lib/quote-template.js";
import {
  getAuthorizedAppState,
  loadData,
  saveData,
  saveAuthorizedAppState,
} from "./server-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const envPath = path.join(__dirname, ".env");
const GEOAPIFY_AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
const GEOAPIFY_GEOCODE_SEARCH_URL = "https://api.geoapify.com/v1/geocode/search";
const DEFAULT_GEOAPIFY_MAP_STYLE = "osm-bright";
const DEFAULT_GEOAPIFY_COUNTRY_CODE = "au";
const DEFAULT_GEOAPIFY_AUTOCOMPLETE_LIMIT = 6;
const MIN_ADDRESS_QUERY_LENGTH = 3;
const MAX_ADDRESS_QUERY_LENGTH = 160;
const GEOAPIFY_MAP_ATTRIBUTION = 'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a> | <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>';
const geoapifyGeocodeCache = new Map();
const BACKUP_FORMAT_VERSION = "elset-backup-v2";
const SERVICE_M8_IMPORT_PREVIEW_TTL_MS = 1000 * 60 * 20;
const serviceM8ImportPreviewCache = new Map();

dotenv.config({ path: envPath });

function getDocumentRequestPayload(body) {
  return body?.document || body?.quote;
}

function getDocumentType(body) {
  return body?.documentType === "invoice" ? "invoice" : "quote";
}

function validateDocumentPayload(body, { requireCustomerEmail = true } = {}) {
  const documentType = getDocumentType(body);
  const documentLabel = documentType === "invoice" ? "invoice" : "quote";
  if (!body || typeof body !== "object") return "Missing request body.";
  if (requireCustomerEmail && !body.job?.customerEmail) {
    return `Customer email is required before sending a ${documentLabel}.`;
  }
  if (!body.job?.customerName) return "Customer name is required.";
  if (!body.job?.title) return "Job title is required.";
  const document = getDocumentRequestPayload(body);
  if (!Array.isArray(document?.items) || document.items.length === 0) {
    return `${documentType === "invoice" ? "Invoice" : "Quote"} items are required.`;
  }
  return null;
}

function getMissingEnv() {
  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
  return required.filter((key) => !process.env[key]);
}

function getConfigSourceLabel() {
  return process.env.FLY_APP_NAME
    ? "the Fly app secrets or environment"
    : envPath;
}

function getTransportConfig() {
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host: process.env.SMTP_HOST,
    port,
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };
}

function getGeoapifyApiKey() {
  return String(process.env.GEOAPIFY_API_KEY || "").trim();
}

function getGeoapifyMapsApiKey() {
  return String(process.env.GEOAPIFY_MAPS_API_KEY || process.env.GEOAPIFY_API_KEY || "").trim();
}

function getGeoapifyCountryCode() {
  const configuredValue = String(process.env.GEOAPIFY_COUNTRY_CODE || DEFAULT_GEOAPIFY_COUNTRY_CODE).trim().toLowerCase();
  return /^[a-z]{2}$/.test(configuredValue) ? configuredValue : "";
}

function getGeoapifyMapStyle() {
  return String(process.env.GEOAPIFY_MAP_STYLE || DEFAULT_GEOAPIFY_MAP_STYLE).trim() || DEFAULT_GEOAPIFY_MAP_STYLE;
}

function getGeoapifyAutocompleteLimit() {
  const configuredValue = Number.parseInt(String(process.env.GEOAPIFY_AUTOCOMPLETE_LIMIT || DEFAULT_GEOAPIFY_AUTOCOMPLETE_LIMIT), 10);
  if (!Number.isFinite(configuredValue)) return DEFAULT_GEOAPIFY_AUTOCOMPLETE_LIMIT;
  return Math.min(Math.max(configuredValue, 1), 10);
}

function logOptionalConfigWarnings() {
  const configSourceLabel = getConfigSourceLabel();
  const missingEmailEnv = getMissingEnv();

  if (missingEmailEnv.length > 0) {
    console.warn(
      `[config] Missing ${missingEmailEnv.join(", ")} in ${configSourceLabel}. Quote email sending will be unavailable.`
    );
  }

  if (!getGeoapifyApiKey()) {
    console.warn(
      `[config] Missing GEOAPIFY_API_KEY in ${configSourceLabel}. Address lookup and map geocoding will be unavailable.`
    );
  }

  if (!getGeoapifyMapsApiKey()) {
    console.warn(
      `[config] Missing GEOAPIFY_MAPS_API_KEY or GEOAPIFY_API_KEY in ${configSourceLabel}. Jobs map tiles will be unavailable.`
    );
  }
}

function buildGeoapifyAutocompleteUrl(query) {
  const params = new URLSearchParams({
    text: query,
    format: "json",
    lang: "en",
    limit: String(getGeoapifyAutocompleteLimit()),
    apiKey: getGeoapifyApiKey(),
  });
  const countryCode = getGeoapifyCountryCode();

  if (countryCode) {
    params.set("filter", `countrycode:${countryCode}`);
  }

  return `${GEOAPIFY_AUTOCOMPLETE_URL}?${params.toString()}`;
}

function buildGeoapifyGeocodeSearchUrl(query) {
  const params = new URLSearchParams({
    text: query,
    format: "json",
    lang: "en",
    limit: "1",
    apiKey: getGeoapifyApiKey(),
  });
  const countryCode = getGeoapifyCountryCode();

  if (countryCode) {
    params.set("filter", `countrycode:${countryCode}`);
  }

  return `${GEOAPIFY_GEOCODE_SEARCH_URL}?${params.toString()}`;
}

function normalizeGeoapifyLocationResult(result) {
  const formatted = typeof result?.formatted === "string" ? result.formatted.trim() : "";
  if (!formatted) return null;

  const addressLine1 = typeof result?.address_line1 === "string" ? result.address_line1.trim() : "";
  const addressLine2 = typeof result?.address_line2 === "string" ? result.address_line2.trim() : "";
  const latitude = Number(result?.lat);
  const longitude = Number(result?.lon);

  return {
    placeId:
      typeof result?.place_id === "string"
        ? result.place_id
        : (typeof result?.rank?.place_id === "string" ? result.rank.place_id : ""),
    formatted,
    addressLine1: addressLine1 || formatted,
    addressLine2,
    city: typeof result?.city === "string" ? result.city : "",
    state: typeof result?.state === "string" ? result.state : "",
    postcode: typeof result?.postcode === "string" ? result.postcode : "",
    country: typeof result?.country === "string" ? result.country : "",
    resultType: typeof result?.result_type === "string" ? result.result_type : "",
    lat: Number.isFinite(latitude) ? latitude : null,
    lon: Number.isFinite(longitude) ? longitude : null,
  };
}

async function geocodeAddressQuery(query, signal) {
  const normalizedQuery = String(query || "").trim().slice(0, MAX_ADDRESS_QUERY_LENGTH);
  if (normalizedQuery.length < MIN_ADDRESS_QUERY_LENGTH) return null;

  const cacheKey = `${getGeoapifyCountryCode() || "world"}:${normalizedQuery.toLowerCase()}`;
  if (geoapifyGeocodeCache.has(cacheKey)) {
    return geoapifyGeocodeCache.get(cacheKey);
  }

  const response = await fetch(buildGeoapifyGeocodeSearchUrl(normalizedQuery), {
    method: "GET",
    signal,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const providerMessage = typeof payload?.message === "string" ? payload.message : "Geoapify geocoding request failed.";
    throw new Error(providerMessage);
  }

  const location = normalizeGeoapifyLocationResult(Array.isArray(payload?.results) ? payload.results[0] : null);
  geoapifyGeocodeCache.set(cacheKey, location);
  return location;
}

function buildBackupFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `elset-admin-backup-${timestamp}.json`;
}

function applyAuthResponseHeaders(res, headers) {
  if (!headers) return;

  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      res.append("Set-Cookie", value);
      return;
    }

    res.setHeader(key, value);
  });
}

function prepareWorkspaceBackupImportData(backupInput) {
  if (!backupInput || typeof backupInput !== "object" || Array.isArray(backupInput)) {
    throw new Error("The uploaded backup must be a JSON object.");
  }

  const backupFormat = String(backupInput.backup?.format || "").trim();
  if (backupFormat && !["elset-backup-v1", BACKUP_FORMAT_VERSION].includes(backupFormat)) {
    throw new Error("This backup file uses an unsupported format.");
  }

  const {
    authUsers: _authUsers,
    backup: _backup,
    backupData: _backupData,
    restorePassword: _restorePassword,
    users: _legacyUsers,
    sessions: _legacySessions,
    ...workspaceData
  } = backupInput;

  return {
    ...workspaceData,
    users: [],
    sessions: [],
    meta: {
      ...(workspaceData.meta || {}),
      authMigration: {
        version: "better-auth-v1",
        migratedAt: new Date().toISOString(),
      },
    },
  };
}

function pruneExpiredServiceM8ImportPreviews() {
  const now = Date.now();
  for (const [previewId, preview] of serviceM8ImportPreviewCache.entries()) {
    if (!preview || preview.expiresAt <= now) {
      serviceM8ImportPreviewCache.delete(previewId);
    }
  }
}

function createServiceM8ImportPreview(user, plan) {
  pruneExpiredServiceM8ImportPreviews();
  const previewId = crypto.randomUUID();
  serviceM8ImportPreviewCache.set(previewId, {
    userId: user?.id || "",
    createdAt: Date.now(),
    expiresAt: Date.now() + SERVICE_M8_IMPORT_PREVIEW_TTL_MS,
    plan,
  });
  return previewId;
}

function takeServiceM8ImportPreview(user, previewId) {
  pruneExpiredServiceM8ImportPreviews();
  const normalizedPreviewId = String(previewId || "").trim();
  if (!normalizedPreviewId) return null;

  const preview = serviceM8ImportPreviewCache.get(normalizedPreviewId);
  if (!preview || preview.userId !== (user?.id || "")) return null;

  serviceM8ImportPreviewCache.delete(normalizedPreviewId);
  return preview.plan;
}

export function createServerApp() {
  const app = express();
  const shouldServeStatic = process.env.ELSET_DISABLE_STATIC !== "true";
  const frontendUrl = String(process.env.ELSET_FRONTEND_URL || "").trim();
  const configSourceLabel = getConfigSourceLabel();
  logOptionalConfigWarnings();

  async function requireAuth(req, res, next) {
    const authSession = await getRequestAuthSession(req);

    if (!authSession?.user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    applyAuthResponseHeaders(res, authSession.headers);
    req.authSession = authSession.session;
    req.user = authSession.user;
    req.rawAuthUser = authSession.rawUser;
    return next();
  }

  function requireRole(roles) {
    return (req, res, next) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: "You do not have permission to perform this action." });
      }
      return next();
    };
  }

  app.get("/api/auth/me", async (req, res) => {
    const authSession = await getRequestAuthSession(req);

    if (!authSession?.user) {
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }

    applyAuthResponseHeaders(res, authSession.headers);
    return res.json({
      ok: true,
      user: authSession.user,
    });
  });

  app.all("/api/auth/{*any}", toNodeHandler(auth));
  app.use(express.json({ limit: "15mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/address/autocomplete", requireAuth, async (req, res) => {
    const apiKey = getGeoapifyApiKey();
    if (!apiKey) {
      return res.status(503).json({
        error: `Address lookup is not configured. Add GEOAPIFY_API_KEY to ${configSourceLabel}.`,
      });
    }

    const query = String(req.query.q || "").trim().slice(0, MAX_ADDRESS_QUERY_LENGTH);
    if (query.length < MIN_ADDRESS_QUERY_LENGTH) {
      return res.json({ ok: true, suggestions: [] });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(buildGeoapifyAutocompleteUrl(query), {
        method: "GET",
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const providerMessage = typeof payload?.message === "string" ? payload.message : "Geoapify autocomplete request failed.";
        return res.status(502).json({ error: providerMessage });
      }

      const seen = new Set();
      const suggestions = (Array.isArray(payload?.results) ? payload.results : [])
        .map(normalizeGeoapifyLocationResult)
        .filter((suggestion) => {
          if (!suggestion) return false;
          const dedupeKey = suggestion.formatted.toLowerCase();
          if (seen.has(dedupeKey)) return false;
          seen.add(dedupeKey);
          return true;
        });

      return res.json({ ok: true, suggestions });
    } catch (error) {
      const message = error?.name === "AbortError"
        ? "Address lookup timed out."
        : (error instanceof Error ? error.message : "Address lookup failed.");
      return res.status(502).json({ error: message });
    } finally {
      clearTimeout(timeoutId);
    }
  });

  app.get("/api/map/config", requireAuth, (req, res) => {
    const mapsApiKey = getGeoapifyMapsApiKey();
    if (!mapsApiKey) {
      return res.status(503).json({
        error: `Map tiles are not configured. Add GEOAPIFY_MAPS_API_KEY or GEOAPIFY_API_KEY to ${configSourceLabel}.`,
      });
    }

    const mapStyle = getGeoapifyMapStyle();
    return res.json({
      ok: true,
      tiles: {
        style: mapStyle,
        url: `https://maps.geoapify.com/v1/tile/${mapStyle}/{z}/{x}/{y}.png?apiKey=${mapsApiKey}`,
        retinaUrl: `https://maps.geoapify.com/v1/tile/${mapStyle}/{z}/{x}/{y}@2x.png?apiKey=${mapsApiKey}`,
        attribution: GEOAPIFY_MAP_ATTRIBUTION,
        maxZoom: 20,
      },
    });
  });

  app.post("/api/map/geocode", requireAuth, async (req, res) => {
    const apiKey = getGeoapifyApiKey();
    if (!apiKey) {
      return res.status(503).json({
        error: `Address geocoding is not configured. Add GEOAPIFY_API_KEY to ${configSourceLabel}.`,
      });
    }

    const requestedAddresses = Array.isArray(req.body?.addresses) ? req.body.addresses : [];
    const addresses = [...new Set(
      requestedAddresses
        .map((address) => String(address || "").trim())
        .filter((address) => address.length >= MIN_ADDRESS_QUERY_LENGTH)
        .slice(0, 200)
    )];

    if (addresses.length === 0) {
      return res.json({ ok: true, results: [] });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const results = await Promise.all(
        addresses.map(async (address) => {
          try {
            const location = await geocodeAddressQuery(address, controller.signal);
            return { address, location };
          } catch {
            return { address, location: null };
          }
        })
      );

      return res.json({ ok: true, results });
    } catch (error) {
      const message = error?.name === "AbortError"
        ? "Map geocoding timed out."
        : (error instanceof Error ? error.message : "Map geocoding failed.");
      return res.status(502).json({ error: message });
    } finally {
      clearTimeout(timeoutId);
    }
  });

  app.get("/api/app-state", requireAuth, (req, res) => {
    try {
      return res.json({
        ok: true,
        state: getAuthorizedAppState(req.user),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load the shared workspace data.";
      return res.status(500).json({ error: message });
    }
  });

  app.put("/api/app-state", requireAuth, (req, res) => {
    try {
      const state = saveAuthorizedAppState(req.user, req.body);
      if (req.user.role !== "technician") {
        syncManagedUserNamesWithStaff(state.staff);
      }

      return res.json({
        ok: true,
        state,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save the shared workspace data.";
      return res.status(500).json({ error: message });
    }
  });

  app.get("/api/admin/user-accounts", requireAuth, requireRole(["admin"]), (_req, res) => {
    try {
      const data = loadData();
      return res.json({
        ok: true,
        accounts: getManagedUserAccounts(data.staff),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load login accounts.";
      return res.status(400).json({ error: message });
    }
  });

  app.put("/api/admin/user-accounts", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const data = loadData();
      const account = await saveManagedUserAccount({
        requestHeaders: fromNodeHeaders(req.headers),
        accountInput: req.body,
        staff: data.staff,
      });

      return res.json({
        ok: true,
        account,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save login account.";
      return res.status(400).json({ error: message });
    }
  });

  app.get("/api/admin/data-backup", requireAuth, requireRole(["admin"]), (req, res) => {
    try {
      const data = loadData();
      const backup = {
        ...data,
        users: [],
        sessions: [],
        authUsers: getAuthBackupUsers(),
        backup: {
          format: BACKUP_FORMAT_VERSION,
          exportedAt: new Date().toISOString(),
          exportedBy: req.user,
          sourceFiles: {
            workspace: "app-data.json",
            auth: "auth.db",
          },
        },
      };
      const payload = JSON.stringify(backup, null, 2);

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${buildBackupFilename()}"`);
      return res.status(200).send(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate the backup file.";
      return res.status(400).json({ error: message });
    }
  });

  app.post("/api/admin/data-backup/restore", requireAuth, requireRole(["admin"]), (req, res) => {
    try {
      const restorePassword = String(req.body?.restorePassword || "");
      const hasWrappedBackup = Object.prototype.hasOwnProperty.call(req.body || {}, "backupData");
      const backupInput = hasWrappedBackup ? req.body?.backupData : req.body;

      if (!restorePassword) {
        return res.status(400).json({ error: "Re-enter your admin password to restore a backup." });
      }

      if (!verifyUserPassword(req.user.id, restorePassword)) {
        return res.status(403).json({ error: "The admin password you entered is incorrect." });
      }

      const workspaceData = saveData(prepareWorkspaceBackupImportData(backupInput));
      const restoredAuth = restoreAuthBackup(backupInput, req.user);
      syncManagedUserNamesWithStaff(workspaceData.staff);
      const resolvedUser = restoredAuth.user || req.user;
      const state = getAuthorizedAppState(resolvedUser);

      return res.json({
        ok: true,
        accounts: getManagedUserAccounts(workspaceData.staff),
        message: restoredAuth.message,
        sessionPreserved: restoredAuth.sessionPreserved,
        state,
        user: resolvedUser,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to restore the backup file.";
      return res.status(400).json({ error: message });
    }
  });

  app.post("/api/admin/servicem8-import/preview", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const plan = await previewServiceM8Import({
        apiKey: req.body?.apiKey,
        existingData: loadData(),
        options: req.body?.options,
      });
      const previewId = createServiceM8ImportPreview(req.user, plan);

      res.setHeader("Cache-Control", "no-store");
      return res.json({
        ok: true,
        importedAt: plan.importedAt,
        previewId,
        summary: plan.summary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to preview the ServiceM8 import.";
      return res.status(400).json({ error: message });
    }
  });

  app.post("/api/admin/servicem8-import/apply", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const existingData = loadData();
      const cachedPlan = takeServiceM8ImportPreview(req.user, req.body?.previewId);
      const { plan, nextData } = cachedPlan
        ? {
            plan: cachedPlan,
            nextData: applyServiceM8ImportPlan(existingData, cachedPlan),
          }
        : await buildAndApplyServiceM8Import({
            apiKey: req.body?.apiKey,
            existingData,
            options: req.body?.options,
          });
      const savedData = saveData(nextData);

      syncManagedUserNamesWithStaff(savedData.staff);

      res.setHeader("Cache-Control", "no-store");
      return res.json({
        ok: true,
        importedAt: plan.importedAt,
        summary: plan.summary,
        state: getAuthorizedAppState(req.user),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to import ServiceM8 data.";
      return res.status(400).json({ error: message });
    }
  });

  const sendDocumentEmail = async (req, res) => {
    const validationError = validateDocumentPayload(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const missingEnv = getMissingEnv();
    if (missingEnv.length > 0) {
      return res.status(500).json({
        error: `Missing SMTP configuration in ${configSourceLabel}: ${missingEnv.join(", ")}.`,
      });
    }

    const { job, template, emailSettings } = req.body;
    const documentType = getDocumentType(req.body);
    const document = getDocumentRequestPayload(req.body);

    try {
      const normalizedTemplate = documentType === "invoice"
        ? normalizeInvoiceTemplate(template)
        : normalizeQuoteTemplate(template);
      const { bytes, filename } = await generateDocumentPdf({
        job,
        document,
        template: normalizedTemplate,
        type: documentType,
      });
      const { subject, body, htmlBody } = buildDocumentEmail({
        job,
        type: documentType,
        emailSettings,
      });
      const transporter = nodemailer.createTransport(getTransportConfig());
      const fromEmail = emailSettings?.fromEmail || process.env.EMAIL_FROM || ADMIN_EMAIL;
      const replyToEmail = emailSettings?.replyToEmail || fromEmail;
      const ccEmail = emailSettings?.ccEmail || undefined;
      const info = await transporter.sendMail({
        from: fromEmail,
        to: job.customerEmail,
        replyTo: replyToEmail,
        cc: ccEmail,
        subject,
        text: body,
        html: htmlBody,
        attachments: [
          {
            filename,
            content: Buffer.from(bytes),
            contentType: "application/pdf",
          },
        ],
      });

      return res.json({
        ok: true,
        messageId: info.messageId,
        sentAt: new Date().toISOString(),
        fromEmail,
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : `Failed to send ${documentType === "invoice" ? "invoice" : "quote"} email.`;
      return res.status(500).json({ error: message });
    }
  };

  app.post("/api/quotes/preview-pdf", requireAuth, requireRole(["admin", "office"]), async (req, res) => {
    const validationError = validateDocumentPayload(req.body, { requireCustomerEmail: false });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { job, template } = req.body;
    const documentType = req.body.documentType === "invoice" ? "invoice" : "quote";
    const document = getDocumentRequestPayload(req.body);

    try {
      const normalizedTemplate = documentType === "invoice"
        ? normalizeInvoiceTemplate(template)
        : normalizeQuoteTemplate(template);
      const { bytes, filename } = await generateDocumentPdf({
        job,
        document,
        template: normalizedTemplate,
        type: documentType,
      });

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return res.send(Buffer.from(bytes));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to render the quote PDF preview.";
      return res.status(500).json({ error: message });
    }
  });

  app.post("/api/quotes/send", requireAuth, requireRole(["admin", "office"]), sendDocumentEmail);
  app.post("/api/documents/send", requireAuth, requireRole(["admin", "office"]), sendDocumentEmail);

  if (shouldServeStatic && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  } else if (frontendUrl) {
    app.get(/^(?!\/api).*/, (req, res) => {
      const targetUrl = new URL(req.originalUrl || "/", frontendUrl).toString();
      res
        .status(200)
        .type("html")
        .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Elset Dev Server</title>
    <style>
      body {
        font-family: system-ui, sans-serif;
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f8fafc;
        color: #0f172a;
      }
      main {
        max-width: 640px;
        padding: 32px;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 20px;
        box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08);
      }
      a {
        color: #0f90cd;
        font-weight: 600;
      }
      code {
        background: #e2e8f0;
        padding: 2px 6px;
        border-radius: 6px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Elset API server is running</h1>
      <p>This port only serves the API during development.</p>
      <p>Open the frontend at <a href="${targetUrl}">${targetUrl}</a>.</p>
      <p>If that page is unavailable, start the full dev stack with <code>npm run dev</code>.</p>
    </main>
  </body>
</html>`);
    });
  }

  return app;
}
