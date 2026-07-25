import express from "express";
import {
  addJobNote,
  addJobPhoto,
  changeJobStatus,
  createJob,
  deleteJob,
  deleteJobPhoto,
  emptyDeletedJobs,
  planJobForTomorrow,
  removeAllJobsFromTomorrow,
  removeJobFromTomorrow,
  restoreDeletedJob,
  scheduleJob,
  updateJobDetails,
  WorkspaceJobError,
} from "./server-workspace-jobs.js";
import { getWorkspaceDbPath, openWorkspaceDb } from "./server-workspace-db.js";
import { getAuthorizedWorkspaceState, getWorkspaceStorageMode } from "./server-workspace-storage.js";

function getRequestBody(req, key) {
  const body = req.body || {};
  return body[key] && typeof body[key] === "object" && !Array.isArray(body[key])
    ? body[key]
    : body;
}

function getStatusCode(error) {
  if (error instanceof WorkspaceJobError) return error.statusCode;
  if (Number.isInteger(error?.statusCode)) return error.statusCode;
  return 500;
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function openSqliteWorkspaceDb(env) {
  const mode = getWorkspaceStorageMode(env);
  if (mode !== "sqlite") {
    throw new WorkspaceJobError("Job record endpoints are available only in SQLite workspace mode.", 409);
  }
  return openWorkspaceDb({ dbPath: getWorkspaceDbPath(env) });
}

function sendSuccess(req, res, result, env) {
  return res.json({
    ok: true,
    result,
    state: getAuthorizedWorkspaceState(req.user, { env }),
  });
}

function handleJobRoute(operation, env) {
  return (req, res) => {
    let db = null;
    try {
      db = openSqliteWorkspaceDb(env);
      const result = operation(db, req);
      return sendSuccess(req, res, result, env);
    } catch (error) {
      const statusCode = getStatusCode(error);
      return res.status(statusCode).json({
        error: getErrorMessage(error, "Unable to update the job records."),
      });
    } finally {
      db?.close();
    }
  };
}

export function createJobRouter({
  requireAuth,
  requireRole,
  env = globalThis.process?.env || {},
} = {}) {
  const router = express.Router();
  const authMiddleware = requireAuth || ((_req, _res, next) => next());
  const manageRoleMiddleware = requireRole ? requireRole(["admin", "office"]) : ((_req, _res, next) => next());
  const limitedRoleMiddleware = requireRole ? requireRole(["admin", "office", "technician"]) : ((_req, _res, next) => next());
  const manageMiddleware = [authMiddleware, manageRoleMiddleware];
  const limitedMiddleware = [authMiddleware, limitedRoleMiddleware];

  router.post(
    "/api/jobs",
    ...manageMiddleware,
    handleJobRoute((db, req) => createJob(db, req.body || {}), env)
  );

  router.patch(
    "/api/jobs/:id",
    ...manageMiddleware,
    handleJobRoute((db, req) => updateJobDetails(db, req.params.id, getRequestBody(req, "job")), env)
  );

  router.patch(
    "/api/jobs/:id/status",
    ...limitedMiddleware,
    handleJobRoute((db, req) => changeJobStatus(db, req.params.id, req.body?.status), env)
  );

  router.patch(
    "/api/jobs/:id/schedule",
    ...manageMiddleware,
    handleJobRoute((db, req) => scheduleJob(db, req.params.id, req.body?.scheduledDate), env)
  );

  router.post(
    "/api/jobs/:id/tomorrow",
    ...manageMiddleware,
    handleJobRoute((db, req) => planJobForTomorrow(db, req.params.id, req.body?.tomorrowDate), env)
  );

  router.delete(
    "/api/jobs/:id/tomorrow",
    ...manageMiddleware,
    handleJobRoute((db, req) => removeJobFromTomorrow(db, req.params.id), env)
  );

  router.delete(
    "/api/jobs/tomorrow",
    ...manageMiddleware,
    handleJobRoute((db, req) => removeAllJobsFromTomorrow(db, req.body?.tomorrowDate), env)
  );

  router.delete(
    "/api/jobs/:id",
    ...manageMiddleware,
    handleJobRoute((db, req) => deleteJob(db, req.params.id), env)
  );

  router.post(
    "/api/jobs/:id/restore",
    ...manageMiddleware,
    handleJobRoute((db, req) => restoreDeletedJob(db, req.params.id), env)
  );

  router.delete(
    "/api/deleted-jobs",
    ...manageMiddleware,
    handleJobRoute((db) => emptyDeletedJobs(db), env)
  );

  router.post(
    "/api/jobs/:id/notes",
    ...limitedMiddleware,
    handleJobRoute((db, req) => addJobNote(db, req.params.id, getRequestBody(req, "note"), req.user), env)
  );

  router.post(
    "/api/jobs/:id/photos",
    ...limitedMiddleware,
    handleJobRoute((db, req) => addJobPhoto(db, req.params.id, getRequestBody(req, "photo")), env)
  );

  router.delete(
    "/api/jobs/:id/photos/:photoId",
    ...limitedMiddleware,
    handleJobRoute((db, req) => deleteJobPhoto(db, req.params.id, req.params.photoId), env)
  );

  return router;
}

export function registerJobRoutes(app, options = {}) {
  app.use(createJobRouter(options));
}
