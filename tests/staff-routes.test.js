import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createStaffRouter } from "../server-staff-routes.js";
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

function staffMember(overrides = {}) {
  return {
    id: "staff-synthetic-field-tech",
    name: "Casey Example",
    role: "Service Technician",
    email: "casey.example@example.test",
    phone: "0400 000 701",
    colour: "#34d399",
    initials: "CE",
    availability: "weekdays",
    employmentType: "full-time",
    notes: "Synthetic staff note.",
    active: true,
    technicianCode: "TECH-SYN-1",
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

function assignedJob(overrides = {}) {
  return {
    id: "demo-job-assigned-staff",
    jobNumber: 2001,
    title: "Synthetic assigned job",
    description: "Synthetic job assigned to a staff member.",
    urgency: "Medium",
    status: "To Do",
    scheduledDate: "2026-08-01",
    assignedTechnicianId: "demo-staff-admin",
    assignedTechnicianName: "Jordan Vale",
    customerId: "demo-customer-arcadia",
    customerName: "Arcadia Example Apartments",
    customerEmail: "accounts@arcadia-example.test",
    customerPhone: "0400 000 201",
    jobAddress: "10 Example Lane, Sampleton VIC 3000",
    ocNumber: "",
    maintenancePlanId: "",
    maintenancePlanName: "",
    maintenanceDueDate: "",
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-10T00:00:00.000Z",
    notes: [],
    photos: [],
    quote: {
      type: "quote",
      issueDate: "2026-01-10",
      notes: "Synthetic quote linked to an assigned job.",
      items: [
        {
          id: "assigned-quote-line",
          description: "Synthetic labour",
          qty: 1,
          rate: 100,
        },
      ],
      sentHistory: [],
    },
    invoice: {
      type: "invoice",
      issueDate: "2026-01-11",
      dueDate: "2026-01-18",
      notes: "Synthetic invoice linked to an assigned job.",
      paymentNotes: "",
      items: [
        {
          id: "assigned-invoice-line",
          description: "Synthetic labour",
          qty: 1,
          rate: 100,
        },
      ],
      payments: [],
      sentHistory: [],
    },
    externalRefs: {},
    ...overrides,
  };
}

function maintenancePlan(overrides = {}) {
  return {
    id: "demo-maintenance-staff-link",
    planName: "Synthetic staff-linked maintenance",
    customerId: "demo-customer-arcadia",
    siteAddress: "10 Example Lane, Sampleton VIC 3000",
    frequency: "quarterly",
    nextDueDate: "2026-09-01",
    defaultTechnicianId: "demo-staff-admin",
    estimatedDurationHours: 2,
    contractPrice: 250,
    checklist: ["Synthetic checklist item"],
    notes: "Synthetic maintenance note.",
    lastGeneratedAt: "",
    lastGeneratedJobId: "",
    lastCompletedAt: "",
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-10T00:00:00.000Z",
    ...overrides,
  };
}

function readRelationshipFixture() {
  const fixture = readFixture();
  fixture.jobs = fixture.jobs.map((job) => (
    job.id === "demo-job-1001"
      ? {
          ...job,
          assignedTechnicianId: "demo-staff-admin",
          assignedTechnicianName: "Jordan Vale",
        }
      : job
  ));
  fixture.jobs.push(assignedJob());
  fixture.maintenancePlans = [maintenancePlan()];
  return fixture;
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "elset-staff-routes-"));
}

async function withTempWorkspace(callback, fixture = readFixture()) {
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
  app.use(createStaffRouter({
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
  }));
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

function getDeletedStaffArchive(dbPath, staffId) {
  const db = openWorkspaceDb({ dbPath });
  try {
    return db.prepare("SELECT * FROM deleted_staff_members WHERE staff_id = ?").get(staffId);
  } finally {
    db.close();
  }
}

test("POST /api/staff creates a staff member and preserves optional fields", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/staff", {
        method: "POST",
        body: JSON.stringify({ staff: staffMember() }),
      });

      assert.equal(result.response.status, 200, result.payload.error);
      assert.equal(result.payload.result.id, "staff-synthetic-field-tech");
      assert.equal(result.payload.result.name, "Casey Example");
      assert.equal(result.payload.result.colour, "#34d399");
      assert.equal(result.payload.result.initials, "CE");
      assert.equal(result.payload.result.availability, "weekdays");
      assert.equal(result.payload.result.employmentType, "full-time");
      assert.equal(result.payload.result.notes, "Synthetic staff note.");
      assert.equal(result.payload.result.active, true);
      assert.equal(result.payload.result.technicianCode, "TECH-SYN-1");
      assert.equal(result.payload.state.staff.some((entry) => entry.id === "staff-synthetic-field-tech"), true);

      const state = getDbState(dbPath);
      const saved = state.staff.find((entry) => entry.id === "staff-synthetic-field-tech");
      assert.equal(saved.email, "casey.example@example.test");
      assert.equal(saved.colour, "#34d399");
    });
  });
});

test("PATCH /api/staff/:id edits supported and optional fields without touching auth accounts", async () => {
  await withTempWorkspace(async ({ env, dbPath, tempDir }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/staff/demo-staff-admin", {
        method: "PATCH",
        body: JSON.stringify({
          staff: {
            name: "Jordan Updated",
            role: "Operations Lead",
            email: "jordan.updated@example.test",
            phone: "0400 000 799",
            colour: "#60a5fa",
            initials: "JU",
            availability: "part-time",
            notes: "Updated synthetic staff note.",
            active: false,
          },
        }),
      });

      assert.equal(result.response.status, 200, result.payload.error);
      assert.equal(result.payload.result.name, "Jordan Updated");
      assert.equal(result.payload.result.role, "Operations Lead");
      assert.equal(result.payload.result.email, "jordan.updated@example.test");
      assert.equal(result.payload.result.phone, "0400 000 799");
      assert.equal(result.payload.result.colour, "#60a5fa");
      assert.equal(result.payload.result.initials, "JU");
      assert.equal(result.payload.result.availability, "part-time");
      assert.equal(result.payload.result.notes, "Updated synthetic staff note.");
      assert.equal(result.payload.result.active, false);
      assert.equal(fs.existsSync(path.join(tempDir, "auth.db")), false);

      const state = getDbState(dbPath);
      assert.equal(state.staff.find((entry) => entry.id === "demo-staff-admin").name, "Jordan Updated");
    });
  });
});

test("staff routes validate required fields, contact details, IDs, and roles", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const missingName = await requestJson(baseUrl, "/api/staff", {
        method: "POST",
        body: JSON.stringify({ staff: staffMember({ id: "staff-missing-name", name: "" }) }),
      });
      assert.equal(missingName.response.status, 400);

      const invalidEmail = await requestJson(baseUrl, "/api/staff", {
        method: "POST",
        body: JSON.stringify({ staff: staffMember({ id: "staff-invalid-email", email: "invalid-email" }) }),
      });
      assert.equal(invalidEmail.response.status, 400);

      const invalidRole = await requestJson(baseUrl, "/api/staff", {
        method: "POST",
        body: JSON.stringify({ staff: staffMember({ id: "staff-invalid-role", role: "x".repeat(121) }) }),
      });
      assert.equal(invalidRole.response.status, 400);

      const invalidId = await requestJson(baseUrl, "/api/staff", {
        method: "POST",
        body: JSON.stringify({ staff: staffMember({ id: "x".repeat(181) }) }),
      });
      assert.equal(invalidId.response.status, 400);

      const missingStaff = await requestJson(baseUrl, "/api/staff/missing-staff", {
        method: "PATCH",
        body: JSON.stringify({ staff: { name: "Missing Staff" } }),
      });
      assert.equal(missingStaff.response.status, 404);
    });
  });
});

test("staff routes preserve existing duplicate email behaviour", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const first = await requestJson(baseUrl, "/api/staff", {
        method: "POST",
        body: JSON.stringify(staffMember({
          id: "staff-duplicate-email-one",
          email: "duplicate.staff@example.test",
        })),
      });
      assert.equal(first.response.status, 200, first.payload.error);

      const second = await requestJson(baseUrl, "/api/staff", {
        method: "POST",
        body: JSON.stringify(staffMember({
          id: "staff-duplicate-email-two",
          email: "duplicate.staff@example.test",
        })),
      });
      assert.equal(second.response.status, 200, second.payload.error);
      assert.equal(second.payload.state.staff.filter((entry) => entry.email === "duplicate.staff@example.test").length, 2);
    });
  });
});

test("DELETE /api/staff/:id archives staff and restore relinks assigned jobs and maintenance plans", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const deleted = await requestJson(baseUrl, "/api/staff/demo-staff-admin", { method: "DELETE" });
      assert.equal(deleted.response.status, 200, deleted.payload.error);
      assert.equal(deleted.payload.result.assignedJobCount, 2);
      assert.equal(deleted.payload.result.maintenancePlanCount, 1);
      assert.equal(deleted.payload.state.staff.some((entry) => entry.id === "demo-staff-admin"), false);

      const deletedState = getDbState(dbPath);
      const activeJob = deletedState.jobs.find((entry) => entry.id === "demo-job-1001");
      const futureJob = deletedState.jobs.find((entry) => entry.id === "demo-job-assigned-staff");
      const plan = deletedState.maintenancePlans.find((entry) => entry.id === "demo-maintenance-staff-link");
      assert.equal(activeJob.assignedTechnicianId, "");
      assert.equal(activeJob.assignedTechnicianName, "Jordan Vale");
      assert.equal(futureJob.assignedTechnicianId, "");
      assert.equal(futureJob.assignedTechnicianName, "Jordan Vale");
      assert.equal(futureJob.quote.items[0].description, "Synthetic labour");
      assert.equal(futureJob.invoice.items[0].description, "Synthetic labour");
      assert.equal(plan.defaultTechnicianId, "");
      assert.ok(getDeletedStaffArchive(dbPath, "demo-staff-admin"));

      const restored = await requestJson(baseUrl, "/api/staff/demo-staff-admin/restore", { method: "POST" });
      assert.equal(restored.response.status, 200, restored.payload.error);
      assert.equal(restored.payload.result.id, "demo-staff-admin");

      const restoredState = getDbState(dbPath);
      assert.equal(restoredState.jobs.find((entry) => entry.id === "demo-job-1001").assignedTechnicianId, "demo-staff-admin");
      assert.equal(restoredState.jobs.find((entry) => entry.id === "demo-job-1001").assignedTechnicianName, "Jordan Vale");
      assert.equal(restoredState.jobs.find((entry) => entry.id === "demo-job-assigned-staff").assignedTechnicianId, "demo-staff-admin");
      assert.equal(restoredState.maintenancePlans.find((entry) => entry.id === "demo-maintenance-staff-link").defaultTechnicianId, "demo-staff-admin");
    });
  }, readRelationshipFixture());
});

test("staff delete rolls back when the archive write fails", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    const db = openWorkspaceDb({ dbPath });
    try {
      db.prepare(`
        INSERT INTO deleted_staff_members (
          id, staff_id, deleted_at, payload_json, assigned_job_ids_json, maintenance_plan_ids_json, extra_json
        ) VALUES ('deleted-staff-member:demo-staff-admin', 'demo-staff-admin', '2026-01-01T00:00:00.000Z', '{}', '[]', '[]', '{}')
      `).run();
    } finally {
      db.close();
    }

    await withServer(env, async (baseUrl) => {
      const deleted = await requestJson(baseUrl, "/api/staff/demo-staff-admin", { method: "DELETE" });
      assert.equal(deleted.response.status, 500);
      const state = getDbState(dbPath);
      assert.equal(state.staff.some((entry) => entry.id === "demo-staff-admin"), true);
    });
  }, readRelationshipFixture());
});

test("staff routes allow office users, reject technicians, and stay unavailable in JSON mode", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/staff", {
        method: "POST",
        body: JSON.stringify({
          staff: staffMember({ id: "office-created-staff" }),
        }),
      });
      assert.equal(result.response.status, 200, result.payload.error);
    }, { role: "office", staffId: "" });

    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/staff", {
        method: "POST",
        body: JSON.stringify({
          staff: staffMember({ id: "technician-created-staff" }),
        }),
      });
      assert.equal(result.response.status, 403);
    }, { role: "technician" });
  });

  const tempDir = makeTempDir();
  const env = {
    ELSET_DATA_DIR: tempDir,
    ELSET_WORKSPACE_STORAGE: "json",
  };

  try {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/staff", {
        method: "POST",
        body: JSON.stringify({
          staff: staffMember({ id: "json-mode-staff-member" }),
        }),
      });
      assert.equal(result.response.status, 409);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
