import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createCustomerRouter } from "../server-customer-routes.js";
import { createJobRouter } from "../server-job-routes.js";
import { createMaintenanceRouter } from "../server-maintenance-routes.js";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(repoRoot, "fixtures", "demo-workspace.json");

function readFixture(overrides = {}) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  return {
    ...fixture,
    ...overrides,
  };
}

function maintenancePlan(overrides = {}) {
  return {
    id: "demo-maintenance-plan",
    planName: "Synthetic quarterly gate service",
    customerId: "demo-customer-arcadia",
    siteAddress: "10 Example Lane, Sampleton VIC 3000",
    frequency: "quarterly",
    nextDueDate: "2026-02-01",
    defaultTechnicianId: "demo-staff-admin",
    estimatedDurationHours: 1.5,
    contractPrice: 220,
    checklist: ["Inspect gate", "Test safety edge"],
    notes: "Synthetic maintenance notes.",
    lastGeneratedAt: "",
    lastGeneratedJobId: "",
    lastCompletedAt: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function maintenanceJob(overrides = {}) {
  return {
    id: "demo-maintenance-job",
    jobNumber: 1100,
    title: "Synthetic quarterly gate service",
    description: "Synthetic generated maintenance job.",
    urgency: "Medium",
    status: "To Do",
    scheduledDate: "2026-02-01",
    assignedTechnicianId: "demo-staff-admin",
    assignedTechnicianName: "Jordan Vale",
    customerId: "demo-customer-arcadia",
    customerName: "Arcadia Example Apartments",
    customerEmail: "accounts@arcadia-example.test",
    customerPhone: "0400 000 201",
    jobAddress: "10 Example Lane, Sampleton VIC 3000",
    maintenancePlanId: "demo-maintenance-plan",
    maintenancePlanName: "Synthetic quarterly gate service",
    maintenanceDueDate: "2026-02-01",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    notes: [],
    photos: [],
    quote: null,
    invoice: null,
    externalRefs: {},
    ...overrides,
  };
}

function fixtureWithMaintenance({ includeJob = false, planOverrides = {}, jobOverrides = {} } = {}) {
  const fixture = readFixture({
    maintenancePlans: [maintenancePlan(planOverrides)],
  });
  if (includeJob) {
    fixture.jobs = [
      maintenanceJob(jobOverrides),
      ...fixture.jobs,
    ];
    fixture.maintenancePlans = [
      maintenancePlan({
        lastGeneratedAt: "2026-01-02T00:00:00.000Z",
        lastGeneratedJobId: "demo-maintenance-job",
        ...planOverrides,
      }),
    ];
  }
  return fixture;
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "elset-maintenance-routes-"));
}

async function withTempWorkspace(callback, fixture = fixtureWithMaintenance()) {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "elset-workspace.db");
  const db = openWorkspaceDb({ dbPath });
  importWorkspaceJsonData(db, fixture);
  db.close();

  const env = {
    ELSET_DATA_DIR: tempDir,
    ELSET_WORKSPACE_STORAGE: "sqlite",
  };

  try {
    return await callback({ tempDir, dbPath, env });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildApp(env, user = {}) {
  const app = express();
  app.use(express.json());
  const authOptions = {
    env,
    requireAuth: (req, _res, next) => {
      req.user = {
        id: user.id || "test-admin",
        role: user.role || "admin",
        username: user.username || "test-admin",
        name: user.name || "Test Admin",
        staffId: user.staffId || "demo-staff-admin",
      };
      next();
    },
    requireRole: (roles) => (req, res, next) => {
      if (!roles.includes(req.user?.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return next();
    },
  };
  app.use(createMaintenanceRouter(authOptions));
  app.use(createJobRouter(authOptions));
  app.use(createCustomerRouter(authOptions));
  return app;
}

async function withServer(env, callback, user = {}) {
  const app = buildApp(env, user);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    return await callback(baseUrl);
  } finally {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function getDbState(dbPath) {
  const db = openWorkspaceDb({ dbPath });
  try {
    return loadWorkspaceStateFromDb(db);
  } finally {
    db.close();
  }
}

test("POST /api/maintenance-plans creates a maintenance plan", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/maintenance-plans", {
        method: "POST",
        body: JSON.stringify({
          plan: maintenancePlan({
            id: "created-maintenance-plan",
            planName: "Synthetic created maintenance plan",
            checklist: ["Created checklist item"],
          }),
        }),
      });

      assert.equal(result.response.status, 200, result.payload.error);
      assert.equal(result.payload.result.id, "created-maintenance-plan");
      assert.equal(result.payload.result.contractPrice, 220);
      assert.deepEqual(result.payload.result.checklist, ["Created checklist item"]);
      assert.equal(result.payload.state.maintenancePlans.some((plan) => plan.id === "created-maintenance-plan"), true);

      const state = getDbState(dbPath);
      assert.equal(state.maintenancePlans.some((plan) => plan.id === "created-maintenance-plan"), true);
    });
  }, readFixture());
});

test("maintenance plan edit, schedule, and complete-cycle routes persist details", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const edited = await requestJson(baseUrl, "/api/maintenance-plans/demo-maintenance-plan", {
        method: "PATCH",
        body: JSON.stringify({
          plan: {
            planName: "Synthetic edited maintenance plan",
            customerId: "demo-customer-arcadia",
            siteAddress: "10 Example Lane, Sampleton VIC 3000",
            frequency: "monthly",
            nextDueDate: "2026-03-01",
            estimatedDurationHours: 2,
            contractPrice: 330.5,
            checklist: ["Edited checklist item"],
            notes: "Edited synthetic notes.",
          },
        }),
      });
      assert.equal(edited.response.status, 200, edited.payload.error);
      assert.equal(edited.payload.result.planName, "Synthetic edited maintenance plan");
      assert.equal(edited.payload.result.frequency, "monthly");
      assert.equal(edited.payload.result.contractPrice, 330.5);

      const scheduled = await requestJson(baseUrl, "/api/maintenance-plans/demo-maintenance-plan/schedule", {
        method: "PATCH",
        body: JSON.stringify({ nextDueDate: "2026-04-15" }),
      });
      assert.equal(scheduled.response.status, 200, scheduled.payload.error);
      assert.equal(scheduled.payload.result.nextDueDate, "2026-04-15");

      const completed = await requestJson(baseUrl, "/api/maintenance-plans/demo-maintenance-plan/complete-cycle", {
        method: "POST",
        body: JSON.stringify({
          completedAt: "2026-04-16T00:00:00.000Z",
          advanceRecurrence: true,
        }),
      });
      assert.equal(completed.response.status, 200, completed.payload.error);
      assert.equal(completed.payload.result.lastCompletedAt, "2026-04-16T00:00:00.000Z");
      assert.equal(completed.payload.result.nextDueDate, "2026-05-15");

      const state = getDbState(dbPath);
      const plan = state.maintenancePlans.find((entry) => entry.id === "demo-maintenance-plan");
      assert.equal(plan.notes, "Edited synthetic notes.");
      assert.equal(plan.nextDueDate, "2026-05-15");
    });
  });
});

test("maintenance job generation advances recurrence and job completion updates the plan", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const generated = await requestJson(baseUrl, "/api/maintenance-plans/demo-maintenance-plan/generate-job", {
        method: "POST",
        body: JSON.stringify({ jobId: "generated-maintenance-job" }),
      });
      assert.equal(generated.response.status, 200, generated.payload.error);
      assert.equal(generated.payload.result.job.id, "generated-maintenance-job");
      assert.equal(generated.payload.result.job.maintenancePlanId, "demo-maintenance-plan");
      assert.equal(generated.payload.result.job.assignedTechnicianId, "demo-staff-admin");
      assert.equal(generated.payload.result.plan.lastGeneratedJobId, "generated-maintenance-job");
      assert.equal(generated.payload.result.plan.nextDueDate, "2026-05-01");

      const completed = await requestJson(baseUrl, "/api/jobs/generated-maintenance-job/status", {
        method: "PATCH",
        body: JSON.stringify({ status: "Completed" }),
      });
      assert.equal(completed.response.status, 200, completed.payload.error);
      const completedPlan = completed.payload.state.maintenancePlans.find((plan) => plan.id === "demo-maintenance-plan");
      assert.ok(completedPlan.lastCompletedAt);

      const state = getDbState(dbPath);
      const plan = state.maintenancePlans.find((entry) => entry.id === "demo-maintenance-plan");
      assert.equal(plan.lastGeneratedJobId, "generated-maintenance-job");
      assert.ok(plan.lastCompletedAt);
    });
  });
});

test("maintenance plan delete archives the plan and restore relinks active jobs", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const deleted = await requestJson(baseUrl, "/api/maintenance-plans/demo-maintenance-plan", { method: "DELETE" });
      assert.equal(deleted.response.status, 200, deleted.payload.error);
      assert.equal(deleted.payload.result.linkedJobCount, 1);
      assert.equal(deleted.payload.state.maintenancePlans.some((plan) => plan.id === "demo-maintenance-plan"), false);
      assert.equal(deleted.payload.state.jobs.find((job) => job.id === "demo-maintenance-job").maintenancePlanId, "");

      const restored = await requestJson(baseUrl, "/api/maintenance-plans/demo-maintenance-plan/restore", { method: "POST" });
      assert.equal(restored.response.status, 200, restored.payload.error);
      assert.equal(restored.payload.result.id, "demo-maintenance-plan");
      assert.equal(restored.payload.state.jobs.find((job) => job.id === "demo-maintenance-job").maintenancePlanId, "demo-maintenance-plan");

      const state = getDbState(dbPath);
      assert.equal(state.maintenancePlans.some((plan) => plan.id === "demo-maintenance-plan"), true);
      assert.equal(state.jobs.find((job) => job.id === "demo-maintenance-job").maintenancePlanId, "demo-maintenance-plan");
    });
  }, fixtureWithMaintenance({ includeJob: true }));
});

test("customer archive and restore preserves related maintenance plans in SQLite mode", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const deleted = await requestJson(baseUrl, "/api/customers/demo-customer-arcadia", { method: "DELETE" });
      assert.equal(deleted.response.status, 200, deleted.payload.error);
      assert.equal(deleted.payload.result.deletedMaintenancePlanCount, 1);
      assert.equal(deleted.payload.state.maintenancePlans.some((plan) => plan.id === "demo-maintenance-plan"), false);

      const restored = await requestJson(baseUrl, "/api/customers/demo-customer-arcadia/restore", { method: "POST" });
      assert.equal(restored.response.status, 200, restored.payload.error);
      assert.equal(restored.payload.state.customers.some((customer) => customer.id === "demo-customer-arcadia"), true);
      assert.equal(restored.payload.state.maintenancePlans.some((plan) => plan.id === "demo-maintenance-plan"), true);

      const state = getDbState(dbPath);
      assert.equal(state.maintenancePlans.some((plan) => plan.id === "demo-maintenance-plan"), true);
    });
  });
});

test("maintenance routes reject invalid relationships and stay unavailable in JSON mode", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const missingCustomer = await requestJson(baseUrl, "/api/maintenance-plans", {
        method: "POST",
        body: JSON.stringify({
          plan: maintenancePlan({
            id: "missing-customer-plan",
            customerId: "missing-customer",
          }),
        }),
      });
      assert.equal(missingCustomer.response.status, 404);

      const missingTechnician = await requestJson(baseUrl, "/api/maintenance-plans/demo-maintenance-plan", {
        method: "PATCH",
        body: JSON.stringify({
          plan: {
            defaultTechnicianId: "missing-staff-member",
          },
        }),
      });
      assert.equal(missingTechnician.response.status, 404);

      const invalidSite = await requestJson(baseUrl, "/api/maintenance-plans/demo-maintenance-plan", {
        method: "PATCH",
        body: JSON.stringify({
          plan: {
            siteId: "missing-site",
          },
        }),
      });
      assert.equal(invalidSite.response.status, 404);

      const invalidDate = await requestJson(baseUrl, "/api/maintenance-plans/demo-maintenance-plan/schedule", {
        method: "PATCH",
        body: JSON.stringify({ nextDueDate: "2026-99-99" }),
      });
      assert.equal(invalidDate.response.status, 400);
    });
  });

  const tempDir = makeTempDir();
  const env = {
    ELSET_DATA_DIR: tempDir,
    ELSET_WORKSPACE_STORAGE: "json",
  };

  try {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/maintenance-plans", {
        method: "POST",
        body: JSON.stringify({
          plan: maintenancePlan({ id: "json-mode-plan" }),
        }),
      });
      assert.equal(result.response.status, 409);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("maintenance plan writes roll back when a related checklist insert fails", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/maintenance-plans", {
        method: "POST",
        body: JSON.stringify({
          plan: maintenancePlan({
            id: "rollback-maintenance-plan",
            checklist: [
              { id: "duplicate-checklist-id", text: "First checklist item" },
              { id: "duplicate-checklist-id", text: "Second checklist item" },
            ],
          }),
        }),
      });

      assert.equal(result.response.status, 500);
      const state = getDbState(dbPath);
      assert.equal(state.maintenancePlans.some((plan) => plan.id === "rollback-maintenance-plan"), false);
    });
  });
});

test("technicians cannot manage maintenance plan records", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/maintenance-plans", {
        method: "POST",
        body: JSON.stringify({
          plan: maintenancePlan({ id: "technician-plan" }),
        }),
      });
      assert.equal(result.response.status, 403);
    }, { role: "technician" });
  });
});
