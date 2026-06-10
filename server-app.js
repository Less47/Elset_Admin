import fs from "fs";
import path from "path";
import express from "express";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { generateDocumentPdf } from "./quote-pdf.js";
import {
  ADMIN_EMAIL,
  buildDocumentEmail,
  normalizeInvoiceTemplate,
  normalizeQuoteTemplate,
} from "./src/lib/quote-template.js";
import {
  authenticateUser,
  getAdminBackup,
  getAdminUserAccounts,
  getAuthorizedAppState,
  getDefaultLoginAccounts,
  getSessionUser,
  revokeSession,
  restoreAdminBackup,
  saveAdminUserAccount,
  saveAuthorizedAppState,
} from "./server-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const envPath = path.join(__dirname, ".env");
const AUTH_DISABLED = true;
const GEOAPIFY_AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
const GEOAPIFY_GEOCODE_SEARCH_URL = "https://api.geoapify.com/v1/geocode/search";
const DEFAULT_GEOAPIFY_MAP_STYLE = "osm-bright";
const DEFAULT_GEOAPIFY_COUNTRY_CODE = "au";
const DEFAULT_GEOAPIFY_AUTOCOMPLETE_LIMIT = 6;
const MIN_ADDRESS_QUERY_LENGTH = 3;
const MAX_ADDRESS_QUERY_LENGTH = 160;
const GEOAPIFY_MAP_ATTRIBUTION = 'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a> | <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>';
const geoapifyGeocodeCache = new Map();
const LOCAL_AUTH_USER = Object.freeze({
  id: "local-auth-disabled-user",
  username: "local-admin",
  name: "Local Admin",
  role: "admin",
  staffId: null,
});

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

function getAuthToken(req) {
  const authorization = req.headers.authorization || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function getRequestUser(req) {
  const token = getAuthToken(req);
  const user = token ? getSessionUser(token) : null;

  if (user) {
    return { token, user };
  }

  if (AUTH_DISABLED) {
    return { token: "", user: LOCAL_AUTH_USER };
  }

  return { token: "", user: null };
}

function buildBackupFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `elset-admin-backup-${timestamp}.json`;
}

export function createServerApp() {
  const app = express();
  const shouldServeStatic = process.env.ELSET_DISABLE_STATIC !== "true";
  const frontendUrl = String(process.env.ELSET_FRONTEND_URL || "").trim();
  app.use(express.json({ limit: "15mb" }));

  function requireAuth(req, res, next) {
    const { token, user } = getRequestUser(req);

    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    req.authToken = token;
    req.user = user;
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

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/address/autocomplete", requireAuth, async (req, res) => {
    const apiKey = getGeoapifyApiKey();
    if (!apiKey) {
      return res.status(503).json({
        error: `Address lookup is not configured. Add GEOAPIFY_API_KEY to ${envPath}.`,
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
        error: `Map tiles are not configured. Add GEOAPIFY_MAPS_API_KEY or GEOAPIFY_API_KEY to ${envPath}.`,
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
        error: `Address geocoding is not configured. Add GEOAPIFY_API_KEY to ${envPath}.`,
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

  app.post("/api/auth/login", (req, res) => {
    if (AUTH_DISABLED) {
      return res.json({
        ok: true,
        token: "",
        user: LOCAL_AUTH_USER,
      });
    }

    const { username, password } = req.body || {};
    const session = authenticateUser(username, password);

    if (!session) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    return res.json({
      ok: true,
      token: session.token,
      user: session.user,
    });
  });

  app.post("/api/auth/logout", requireAuth, (req, res) => {
    if (req.authToken) {
      revokeSession(req.authToken);
    }
    return res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    return res.json({
      ok: true,
      user: req.user,
      demoAccounts: getDefaultLoginAccounts(),
    });
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
      return res.json({
        ok: true,
        state: saveAuthorizedAppState(req.user, req.body),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save the shared workspace data.";
      return res.status(500).json({ error: message });
    }
  });

  app.get("/api/admin/user-accounts", requireAuth, requireRole(["admin"]), (req, res) => {
    try {
      return res.json({
        ok: true,
        accounts: getAdminUserAccounts(req.user),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load login accounts.";
      return res.status(400).json({ error: message });
    }
  });

  app.put("/api/admin/user-accounts", requireAuth, requireRole(["admin"]), (req, res) => {
    try {
      return res.json({
        ok: true,
        account: saveAdminUserAccount(req.user, req.body),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save login account.";
      return res.status(400).json({ error: message });
    }
  });

  app.get("/api/admin/data-backup", requireAuth, requireRole(["admin"]), (req, res) => {
    try {
      const backup = getAdminBackup(req.user);
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
      const restored = restoreAdminBackup(req.user, req.body, req.authToken);
      return res.json({
        ok: true,
        ...restored,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to restore the backup file.";
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
        error: `Missing SMTP configuration in ${envPath}: ${missingEnv.join(", ")}.`,
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
