import fs from "fs";
import path from "path";
import express from "express";
import dotenv from "dotenv";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { fileURLToPath } from "url";
import { generateDocumentPdf } from "./quote-pdf.js";
import { createDocumentJsonParser } from "./server-document-json.js";
import { DocumentEmailError, submitDocumentEmail } from "./server-document-email.js";
import { documentSendErrorMessage } from "./src/lib/document-send-status.js";
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
  getDocumentRecipientEmail,
  normalizeInvoiceTemplate,
  normalizeQuoteTemplate,
} from "./src/lib/quote-template.js";
import {
  getAuthorizedWorkspaceState,
  getWorkspaceReadinessStatus,
  getWorkspaceStorageMode,
  getWorkspaceStorageStatus,
  loadWorkspaceState,
  saveAuthorizedWorkspaceState,
  saveWorkspaceState,
} from "./server-workspace-storage.js";
import { registerCustomerRoutes } from "./server-customer-routes.js";
import { registerDocumentRoutes } from "./server-document-routes.js";
import { registerInventoryRoutes } from "./server-inventory-routes.js";
import { registerJobRoutes } from "./server-job-routes.js";
import { registerMaintenanceRoutes } from "./server-maintenance-routes.js";
import { registerSettingsRoutes } from "./server-settings-routes.js";
import { createMapLocationsRouter } from "./server-map-locations-routes.js";
import { createWorkspaceLogoRouter } from "./server-workspace-logo-routes.js";
import { createUserPreferencesRouter } from "./server-user-preferences-routes.js";
import { registerStaffRoutes } from "./server-staff-routes.js";
import { registerServiceM8ImportRoutes } from "./server-servicem8-import-routes.js";
import { registerWorkspaceRestoreRoutes } from "./server-workspace-restore-routes.js";
import {
  MAX_SQLITE_BACKUP_PAYLOAD_BYTES,
  createWorkspaceSqliteBackupBundle,
} from "./server-workspace-backup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const envPath = path.join(__dirname, ".env");
const BACKUP_FORMAT_VERSION = "elset-backup-v2";

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
  if (requireCustomerEmail && !getDocumentRecipientEmail(body.job)) {
    return `A billing or customer email is required before sending a ${documentLabel}.`;
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

function logOptionalConfigWarnings() {
  const missingEmailEnv = getMissingEnv();
  if (missingEmailEnv.length > 0) {
    console.warn(
      `[config] Missing ${missingEmailEnv.join(", ")} in ${getConfigSourceLabel()}. Quote email sending will be unavailable.`
    );
  }
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

export function createServerApp() {
  const app = express();
  const shouldServeStatic = process.env.ELSET_DISABLE_STATIC !== "true";
  const frontendUrl = String(process.env.ELSET_FRONTEND_URL || "").trim();
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
  // Authenticate before reading PDF/email bodies; register these complete routes
  // before the workspace parser so their own finite limit takes effect.
  const documentMiddleware = [requireAuth, requireRole(["admin", "office"]), createDocumentJsonParser()];
  const sendDocumentEmail = async (req, res) => {
    const validationError = validateDocumentPayload(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const missingEnv = getMissingEnv();
    if (missingEnv.length > 0) {
      return res.status(500).json({
        code: "EMAIL_NOT_CONFIGURED",
        error: documentSendErrorMessage(getDocumentType(req.body), "EMAIL_NOT_CONFIGURED"),
      });
    }

    const { job, template, emailSettings, emailPurpose, stampText } = req.body;
    const documentType = getDocumentType(req.body);
    const document = getDocumentRequestPayload(req.body);
    try {
      return res.json(await submitDocumentEmail({
        job, document, template, type: documentType, stampText, emailSettings, emailPurpose,
        defaultFromEmail: process.env.EMAIL_FROM, transportConfig: getTransportConfig(),
      }));
    } catch (error) {
      const code = error instanceof DocumentEmailError ? error.code : "SEND_FAILED";
      return res.status(500).json({ code, error: documentSendErrorMessage(documentType, code) });
    }
  };

  app.post("/api/quotes/preview-pdf", ...documentMiddleware, async (req, res) => {
    const validationError = validateDocumentPayload(req.body, { requireCustomerEmail: false });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { job, template, stampText } = req.body;
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
        stampText,
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

  app.post("/api/quotes/send", ...documentMiddleware, sendDocumentEmail);
  app.post("/api/documents/send", ...documentMiddleware, sendDocumentEmail);

  app.use("/api/admin/workspace-restore", express.json({ limit: MAX_SQLITE_BACKUP_PAYLOAD_BYTES }));
  app.use(express.json({ limit: "15mb" }));
  app.use(createMapLocationsRouter({
    requireAuth,
    requireRole,
    readWorkspace: (user) => getAuthorizedWorkspaceState(user),
  }));

  app.get("/api/health", (_req, res) => {
    const readiness = getWorkspaceReadinessStatus();
    if (!readiness.ok) {
      return res.status(503).json(readiness);
    }

    return res.json(readiness);
  });

  app.get("/api/app-state", requireAuth, (req, res) => {
    try {
      return res.json({
        ok: true,
        storageMode: getWorkspaceStorageMode(),
        state: getAuthorizedWorkspaceState(req.user),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load the shared workspace data.";
      return res.status(500).json({ error: message });
    }
  });

  app.put("/api/app-state", requireAuth, (req, res) => {
    try {
      const state = saveAuthorizedWorkspaceState(req.user, req.body);
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

  registerCustomerRoutes(app, { requireAuth, requireRole });
  registerJobRoutes(app, { requireAuth, requireRole });
  registerDocumentRoutes(app, { requireAuth, requireRole });
  registerMaintenanceRoutes(app, { requireAuth, requireRole });
  registerInventoryRoutes(app, { requireAuth, requireRole });
  registerStaffRoutes(app, { requireAuth, requireRole });
  registerSettingsRoutes(app, { requireAuth, requireRole });
  app.use(createWorkspaceLogoRouter({ requireAuth, requireRole }));
  app.use(createUserPreferencesRouter({ requireAuth }));
  registerServiceM8ImportRoutes(app, {
    requireAuth,
    requireRole,
    syncManagedUserNamesWithStaffFn: syncManagedUserNamesWithStaff,
  });
  registerWorkspaceRestoreRoutes(app, {
    requireAuth,
    requireRole,
    verifyUserPassword,
  });

  app.get("/api/admin/user-accounts", requireAuth, requireRole(["admin"]), (_req, res) => {
    try {
      const data = loadWorkspaceState();
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
      const data = loadWorkspaceState();
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

  app.get("/api/admin/data-backup", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      if (getWorkspaceStorageMode() === "sqlite") {
        const backup = await createWorkspaceSqliteBackupBundle({ exportedBy: req.user });
        const payload = JSON.stringify(backup, null, 2);

        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${buildBackupFilename()}"`);
        return res.status(200).send(payload);
      }

      const data = loadWorkspaceState();
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
      if (getWorkspaceStorageMode() === "sqlite") {
        return res.status(409).json({
          error: "Use the SQLite workspace restore endpoint for SQLite backups.",
        });
      }

      const restorePassword = String(req.body?.restorePassword || "");
      const hasWrappedBackup = Object.prototype.hasOwnProperty.call(req.body || {}, "backupData");
      const backupInput = hasWrappedBackup ? req.body?.backupData : req.body;

      if (!restorePassword) {
        return res.status(400).json({ error: "Re-enter your admin password to restore a backup." });
      }

      if (!verifyUserPassword(req.user.id, restorePassword)) {
        return res.status(403).json({ error: "The admin password you entered is incorrect." });
      }

      const workspaceData = saveWorkspaceState(prepareWorkspaceBackupImportData(backupInput));
      const restoredAuth = restoreAuthBackup(backupInput, req.user);
      syncManagedUserNamesWithStaff(workspaceData.staff);
      const resolvedUser = restoredAuth.user || req.user;
      const state = getAuthorizedWorkspaceState(resolvedUser);

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

  app.get("/api/admin/workspace-storage", requireAuth, requireRole(["admin"]), (_req, res) => {
    try {
      return res.json({
        ok: true,
        storage: getWorkspaceStorageStatus(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to inspect workspace storage.";
      return res.status(400).json({ error: message });
    }
  });

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
