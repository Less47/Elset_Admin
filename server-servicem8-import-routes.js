import crypto from "crypto";
import express from "express";
import {
  applyServiceM8ImportPlan,
  buildAndApplyServiceM8Import,
  previewServiceM8Import,
} from "./server-servicem8-importer.js";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { applyServiceM8ImportPlanToSqlite, ServiceM8SqliteImportError } from "./server-workspace-servicem8-import.js";
import {
  getAuthorizedWorkspaceState,
  getWorkspaceStorageMode,
  loadWorkspaceState,
  saveWorkspaceState,
} from "./server-workspace-storage.js";

const SERVICE_M8_IMPORT_PREVIEW_TTL_MS = 1000 * 60 * 20;
const serviceM8ImportPreviewCache = new Map();

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

function getStatusCode(error) {
  if (error instanceof ServiceM8SqliteImportError) return error.statusCode;
  return 400;
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

export function createServiceM8ImportRouter({
  env = globalThis.process?.env || {},
  requireAuth,
  requireRole,
  loadWorkspaceStateFn = loadWorkspaceState,
  saveWorkspaceStateFn = saveWorkspaceState,
  getAuthorizedWorkspaceStateFn = getAuthorizedWorkspaceState,
  syncManagedUserNamesWithStaffFn = () => {},
} = {}) {
  const router = express.Router();
  const authMiddleware = requireAuth || ((_req, _res, next) => next());
  const adminMiddleware = requireRole ? requireRole(["admin"]) : ((_req, _res, next) => next());
  const middleware = [authMiddleware, adminMiddleware];

  router.post("/api/admin/servicem8-import/preview", ...middleware, async (req, res) => {
    try {
      const plan = await previewServiceM8Import({
        apiKey: req.body?.apiKey,
        existingData: loadWorkspaceStateFn({ env }),
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
      const message = getErrorMessage(error, "Unable to preview the ServiceM8 import.");
      return res.status(400).json({ error: message });
    }
  });

  router.post("/api/admin/servicem8-import/apply", ...middleware, async (req, res) => {
    let db = null;
    try {
      const mode = getWorkspaceStorageMode(env);
      const cachedPlan = takeServiceM8ImportPreview(req.user, req.body?.previewId);
      const shouldDryRun = Boolean(req.body?.dryRun || req.body?.validateOnly);

      if (mode === "sqlite") {
        const plan = cachedPlan || await previewServiceM8Import({
          apiKey: req.body?.apiKey,
          existingData: loadWorkspaceStateFn({ env }),
          options: req.body?.options,
        });

        db = openWorkspaceDb({ dbPath: getWorkspaceDbPath(env) });
        const result = applyServiceM8ImportPlanToSqlite(db, plan, { dryRun: shouldDryRun });

        res.setHeader("Cache-Control", "no-store");
        return res.json({
          ok: true,
          importedAt: result.importedAt,
          dryRun: result.dryRun,
          summary: result.summary,
          state: getAuthorizedWorkspaceStateFn(req.user, { env }),
        });
      }

      const existingData = loadWorkspaceStateFn({ env });
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
      const savedData = shouldDryRun ? existingData : saveWorkspaceStateFn(nextData, { env });

      if (!shouldDryRun) {
        syncManagedUserNamesWithStaffFn(savedData.staff);
      }

      res.setHeader("Cache-Control", "no-store");
      return res.json({
        ok: true,
        importedAt: plan.importedAt,
        dryRun: shouldDryRun,
        summary: plan.summary,
        state: getAuthorizedWorkspaceStateFn(req.user, { env }),
      });
    } catch (error) {
      const message = getErrorMessage(error, "Unable to import ServiceM8 data.");
      return res.status(getStatusCode(error)).json({ error: message });
    } finally {
      db?.close();
    }
  });

  return router;
}

export function registerServiceM8ImportRoutes(app, options = {}) {
  app.use(createServiceM8ImportRouter(options));
}
