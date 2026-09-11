import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createJobRouter } from "../server-job-routes.js";
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

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "elset-job-routes-"));
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
  app.use(createJobRouter({
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

function bulkFixture() {
  const fixture = readFixture();
  const base = fixture.jobs[0];
  fixture.jobs = Array.from({ length: 8 }, (_, index) => ({
    ...base,
    ...(index ? { notes: [], photos: [], quote: null, invoice: null } : {}),
    id: index ? `bulk-${index}` : base.id,
    jobNumber: 1001 + index,
    status: index % 2 ? "In Progress" : "To Do",
    scheduledDate: "2026-09-14",
    assignedTechnicianId: "demo-staff-admin",
    assignedTechnicianName: "Jordan Vale",
    scheduledTime: index % 2 ? "11:30" : "09:00",
    importedScheduling: { startTime: "10:30", notes: "Keep imported time metadata" },
  }));
  return fixture;
}

async function bulkPreview(baseUrl, sourceDate = "2026-09-14") {
  const { response, payload } = await requestJson(baseUrl, `/api/jobs/reschedule-day?sourceDate=${sourceDate}`);
  assert.equal(response.status, 200, payload.error);
  return payload.result.jobs.map(({ job, revision }) => ({ id: job.id, revision }));
}

async function bulkMove(baseUrl, jobs, sourceDate = "2026-09-14", scheduledDate = "2026-09-15") {
  return requestJson(baseUrl, "/api/jobs/reschedule-day", { method: "POST", body: JSON.stringify({ sourceDate, scheduledDate, jobs }) });
}

test("bulk rescheduling persists eight date-only updates and preserves every other job field", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => withServer(env, async (baseUrl) => {
    const before = getDbState(dbPath);
    const entries = await bulkPreview(baseUrl);
    assert.equal(entries.length, 8);
    const { response, payload } = await bulkMove(baseUrl, entries, "2026-09-14", "2026-10-04");
    assert.equal(response.status, 200, payload.error);
    assert.equal(payload.result.succeeded.length, 8);
    assert.deepEqual(payload.result.failed, []);
    const after = getDbState(dbPath);
    for (const previous of before.jobs) {
      const saved = after.jobs.find((job) => job.id === previous.id);
      const omitDates = ({ scheduledDate, updatedAt, ...rest }) => { assert.ok(scheduledDate); assert.ok(updatedAt); return rest; };
      assert.equal(saved.scheduledDate, "2026-10-04");
      assert.deepEqual(omitDates(saved), omitDates(previous));
      assert.equal(payload.result.succeeded.find((entry) => entry.id === saved.id).revision, (await bulkPreview(baseUrl, "2026-10-04")).find((entry) => entry.id === saved.id).revision);
    }
    for (const key of ["customers", "staff", "settings", "inventoryItems", "maintenancePlans"]) assert.deepEqual(after[key], before[key]);
    assert.deepEqual(await bulkPreview(baseUrl), []);
  }), bulkFixture());
});

test("bulk conflicts skip edited, completed and deleted jobs and allow reviewed retry", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => withServer(env, async (baseUrl) => {
    const entries = await bulkPreview(baseUrl);
    await requestJson(baseUrl, "/api/jobs/bulk-1", { method: "PATCH", body: JSON.stringify({ title: "Changed on another device" }) });
    await requestJson(baseUrl, "/api/jobs/bulk-2/status", { method: "PATCH", body: JSON.stringify({ status: "Completed" }) });
    await requestJson(baseUrl, "/api/jobs/bulk-3", { method: "DELETE" });
    const { payload } = await bulkMove(baseUrl, entries);
    assert.equal(payload.result.succeeded.length, 5);
    assert.deepEqual(payload.result.failed.map((entry) => entry.id).sort(), ["bulk-1", "bulk-2", "bulk-3"]);
    const state = getDbState(dbPath);
    assert.equal(state.jobs.find((job) => job.id === "bulk-1").scheduledDate, "2026-09-14");
    assert.equal(state.jobs.find((job) => job.id === "bulk-1").title, "Changed on another device");
    assert.equal(state.jobs.find((job) => job.id === "bulk-2").scheduledDate, "2026-09-14");
    assert.equal(state.jobs.some((job) => job.id === "bulk-3"), false);
    assert.equal(state.deletedJobs.some(({ job }) => job.id === "bulk-3"), true);
    const remaining = await bulkPreview(baseUrl);
    assert.deepEqual(remaining.map((entry) => entry.id), ["bulk-1"]);
    assert.equal((await bulkMove(baseUrl, remaining)).payload.result.succeeded.length, 1);
  }), bulkFixture());
});

test("bulk Undo uses post-move tokens and rejects newer related-record edits even with the same job timestamp", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => withServer(env, async (baseUrl) => {
    const moved = (await bulkMove(baseUrl, await bulkPreview(baseUrl))).payload.result;
    const timestamp = getDbState(dbPath).jobs.find((job) => job.id === "bulk-1").updatedAt;
    await requestJson(baseUrl, "/api/jobs/bulk-1/notes", { method: "POST", body: JSON.stringify({ text: "New note after move" }) });
    const db = openWorkspaceDb({ dbPath });
    try { db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(timestamp, "bulk-1"); } finally { db.close(); }
    const beforeUndo = getDbState(dbPath);
    const undo = await bulkMove(baseUrl, moved.succeeded.map(({ id, revision }) => ({ id, revision })), "2026-09-15", "2026-09-14");
    assert.equal(undo.payload.result.succeeded.length, 7);
    assert.deepEqual(undo.payload.result.failed.map((entry) => entry.id), ["bulk-1"]);
    const after = getDbState(dbPath);
    for (const previous of beforeUndo.jobs) {
      const saved = after.jobs.find((job) => job.id === previous.id);
      assert.equal(saved.scheduledDate, saved.id === "bulk-1" ? "2026-09-15" : "2026-09-14");
      const { scheduledDate, updatedAt, ...rest } = saved;
      assert.deepEqual({ ...rest, scheduledDate: previous.scheduledDate, updatedAt: previous.updatedAt }, previous);
      assert.ok(scheduledDate && updatedAt);
    }
    assert.equal((await bulkMove(baseUrl, moved.succeeded.map(({ id, revision }) => ({ id, revision })), "2026-09-15", "2026-09-14")).payload.result.succeeded.length, 0);
  }), bulkFixture());
});

test("bulk endpoint rejects invalid dates, duplicate IDs, unguarded/arbitrary payloads and unauthorized roles", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const jobs = await bulkPreview(baseUrl);
      const before = getDbState(dbPath);
      for (const scheduledDate of ["", "2026-02-30", "2026-09-14", "2026-09-15T00:00:00Z"]) assert.equal((await bulkMove(baseUrl, jobs, "2026-09-14", scheduledDate)).response.status, 400);
      for (const selection of [[], [jobs[0], jobs[0]], [{ id: jobs[0].id }], [{ ...jobs[0], status: "Completed" }]]) assert.equal((await bulkMove(baseUrl, selection)).response.status, 400);
      assert.equal((await requestJson(baseUrl, "/api/jobs/reschedule-day", { method: "POST", body: JSON.stringify({ sourceDate: "2026-09-14", scheduledDate: "2026-09-15", jobs, state: {} }) })).response.status, 400);
      assert.deepEqual(getDbState(dbPath), before);
    });
    await withServer(env, async (baseUrl) => {
      assert.equal((await requestJson(baseUrl, "/api/jobs/reschedule-day?sourceDate=2026-09-14")).response.status, 403);
      assert.equal((await bulkMove(baseUrl, [])).response.status, 403);
    }, { role: "technician" });
  }, bulkFixture());
});

test("unexpected bulk database failures roll back every date write", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => withServer(env, async (baseUrl) => {
    const entries = await bulkPreview(baseUrl);
    const before = getDbState(dbPath);
    const db = openWorkspaceDb({ dbPath });
    try { db.exec("CREATE TRIGGER fail_bulk BEFORE UPDATE OF scheduled_date ON jobs WHEN NEW.id = 'bulk-3' BEGIN SELECT RAISE(ABORT, 'Synthetic write failure'); END"); } finally { db.close(); }
    assert.equal((await bulkMove(baseUrl, entries)).response.status, 500);
    assert.deepEqual(getDbState(dbPath), before);
  }), bulkFixture());
});

test("date scheduling and removal preserve time, status, assignment and commercial records", async () => {
  const fixture = readFixture();
  fixture.jobs.find((job) => job.id === "demo-job-1001").scheduledTime = "10:30";
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const assigned = await requestJson(baseUrl, "/api/jobs/demo-job-1001", { method: "PATCH", body: JSON.stringify({ assignedTechnicianId: "demo-staff-admin", urgency: "High" }) });
      assert.equal(assigned.response.status, 200);
      for (const status of ["To Do", "In Progress", "Completed"]) {
        const statusResult = await requestJson(baseUrl, "/api/jobs/demo-job-1001/status", { method: "PATCH", body: JSON.stringify({ status }) });
        assert.equal(statusResult.response.status, 200);
        const before = getDbState(dbPath).jobs.find((job) => job.id === "demo-job-1001");
        assert.equal(before.assignedTechnicianId, "demo-staff-admin");
        assert.equal(before.scheduledTime, "10:30");
        assert.ok(before.quote);
        assert.ok(before.invoice);
        const { scheduledDate: previousDate, updatedAt: previousUpdate, ...unchanged } = before;
        assert.equal(typeof previousDate, "string");
        assert.equal(typeof previousUpdate, "string");
        for (const scheduledDate of ["2026-09-15", "2026-10-04", ""]) {
          const result = await requestJson(baseUrl, "/api/jobs/demo-job-1001/schedule", { method: "PATCH", body: JSON.stringify({ scheduledDate }) });
          assert.equal(result.response.status, 200);
          assert.equal(result.payload.state.jobs.find((job) => job.id === before.id).scheduledTime, "10:30");
          const saved = getDbState(dbPath).jobs.find((job) => job.id === before.id);
          const { scheduledDate: savedDate, updatedAt, ...remaining } = saved;
          assert.equal(savedDate, scheduledDate);
          assert.equal(typeof updatedAt, "string");
          assert.deepEqual(remaining, unchanged);
        }
      }
    });
  }, fixture);
});

test("job create saves contact snapshot names and roles without rewriting the master contact", async () => {
  const fixture = readFixture();
  fixture.customers[0].contacts = [{ id: "saved-caretaker", name: "John Smith", role: "Caretaker", phone: "0400 123 456" }];
  await withTempWorkspace(async ({ env, dbPath }) => {
    const before = getDbState(dbPath).customers[0].contacts.find((contact) => contact.id === "saved-caretaker");
    await withServer(env, async (baseUrl) => {
      for (const [index, name] of ["John Smith", "Mary Jane Brown", "A  B Services"].entries()) {
        const created = await requestJson(baseUrl, "/api/jobs", {
          method: "POST",
          body: JSON.stringify({
            customer: { id: fixture.customers[0].id },
            siteInput: { address: `${index + 20} Contact Street, Melbourne VIC 3000`, contactName: name, contactPhone: "0400 123 456" },
            job: { title: "Contact regression", description: "Preserve the current contact draft", onsiteContact: { name: ` ${name} `, role: " Site Manager ", phone: "0400 123 456" } },
          }),
        });
        assert.equal(created.response.status, 200, created.payload.error);
        const state = getDbState(dbPath);
        const saved = state.jobs.find((job) => job.id === created.payload.result.id);
        assert.equal(saved.onsiteContact.name, name);
        assert.equal(saved.onsiteContact.role, "Site Manager");
        assert.deepEqual(state.customers[0].contacts.find((contact) => contact.id === "saved-caretaker"), before);
      }
    });
  }, fixture);
});

test("job create supports existing customer/site, new customer/site, existing customer/new site, and server job numbers", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const existingSite = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customer: { id: "demo-customer-arcadia" },
          job: {
            id: "job-existing-site",
            jobNumber: 1001,
            title: "Synthetic repair for existing site",
            description: "Synthetic existing-site job.",
            jobAddress: "10 Example Lane, Sampleton VIC 3000",
            urgency: "High",
            assignedTechnicianId: "demo-staff-admin",
          },
        }),
      });

      assert.equal(existingSite.response.status, 200, existingSite.payload.error);
      assert.equal(existingSite.payload.result.id, "job-existing-site");
      assert.equal(existingSite.payload.result.jobNumber, 1002);
      assert.equal(existingSite.payload.result.customerName, "Arcadia Example Apartments");
      assert.equal(existingSite.payload.result.onsiteContact.name, "Taylor Example");

      const newCustomer = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customerMode: "new",
          customer: {
            id: "customer-new-job",
            name: "Synthetic New Customer",
            email: "accounts@new-customer.example.test",
            phone: "0400 111 222",
          },
          siteInput: {
            id: "site-new-job",
            address: "22 New Site Road, Sampleton VIC 3000",
            siteType: "commercial",
            ocNumber: "PS123456",
          },
          job: {
            id: "job-new-customer",
            title: "Synthetic new-customer job",
            description: "Synthetic new-customer job.",
            ocNumber: "CLIENT-PO-NEW-1",
          },
        }),
      });

      assert.equal(newCustomer.response.status, 200, newCustomer.payload.error);
      assert.equal(newCustomer.payload.result.customerId, "customer-new-job");
      assert.equal(newCustomer.payload.result.jobAddress, "22 New Site Road, Sampleton VIC 3000");
      assert.equal(newCustomer.payload.result.ocNumber, "CLIENT-PO-NEW-1");
      assert.equal(newCustomer.payload.state.customers.some((customer) => customer.id === "customer-new-job"), true);
      assert.equal(
        newCustomer.payload.state.customers.find((customer) => customer.id === "customer-new-job").sites[0].ocNumber,
        "PS123456"
      );

      const newSite = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customer: { id: "demo-customer-arcadia" },
          siteInput: {
            id: "site-created-with-job",
            address: "33 Created Site Avenue, Sampleton VIC 3000",
            assets: [
              {
                id: "asset-created-with-job",
                name: "Synthetic created gate",
              },
            ],
          },
          job: {
            id: "job-new-site",
            title: "Synthetic new-site job",
            description: "Synthetic new-site job.",
          },
        }),
      });

      assert.equal(newSite.response.status, 200, newSite.payload.error);
      assert.equal(newSite.payload.result.jobAddress, "33 Created Site Avenue, Sampleton VIC 3000");
      assert.equal(
        newSite.payload.state.customers
          .find((customer) => customer.id === "demo-customer-arcadia")
          .sites.some((site) => site.id === "site-created-with-job"),
        true
      );

      const duplicateRequestedNumber = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customer: { id: "demo-customer-arcadia" },
          job: {
            id: "job-duplicate-number",
            jobNumber: 1001,
            title: "Synthetic duplicate-number request",
            jobAddress: "10 Example Lane, Sampleton VIC 3000",
          },
        }),
      });

      assert.equal(duplicateRequestedNumber.response.status, 200, duplicateRequestedNumber.payload.error);
      assert.notEqual(duplicateRequestedNumber.payload.result.jobNumber, 1001);

      const state = getDbState(dbPath);
      const jobNumbers = state.jobs.map((job) => job.jobNumber);
      assert.equal(new Set(jobNumbers).size, jobNumbers.length);
      assert.equal(state.customers.find((customer) => customer.id === "customer-new-job").sites[0].id, "site-new-job");
    });
  });
});

test("job edit, schedule, tomorrow planning, and status updates persist", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const update = await requestJson(baseUrl, "/api/jobs/demo-job-1001", {
        method: "PATCH",
        body: JSON.stringify({
          title: "Updated synthetic job",
          description: "Updated synthetic description.",
          urgency: "High",
          ocNumber: "CLIENT-PO-UPDATED",
          requesterContact: {
            name: "Request Example",
            phone: "0400 333 444",
          },
          assignedTechnicianId: "demo-staff-admin",
        }),
      });

      assert.equal(update.response.status, 200, update.payload.error);
      assert.equal(update.payload.result.title, "Updated synthetic job");
      assert.equal(update.payload.result.ocNumber, "CLIENT-PO-UPDATED");
      assert.equal(update.payload.result.requesterContact.name, "Request Example");

      const schedule = await requestJson(baseUrl, "/api/jobs/demo-job-1001/schedule", {
        method: "PATCH",
        body: JSON.stringify({ scheduledDate: "2026-02-04" }),
      });
      assert.equal(schedule.response.status, 200, schedule.payload.error);
      assert.equal(schedule.payload.result.scheduledDate, "2026-02-04");

      const plan = await requestJson(baseUrl, "/api/jobs/demo-job-1001/tomorrow", {
        method: "POST",
        body: JSON.stringify({ tomorrowDate: "2026-02-05" }),
      });
      assert.equal(plan.response.status, 200, plan.payload.error);
      assert.equal(plan.payload.result.serviceBoardTomorrowDate, "2026-02-05");
      assert.equal(plan.payload.result.scheduledDate, "2026-02-05");

      const status = await requestJson(baseUrl, "/api/jobs/demo-job-1001/status", {
        method: "PATCH",
        body: JSON.stringify({ status: "Completed" }),
      });
      assert.equal(status.response.status, 200, status.payload.error);
      assert.equal(status.payload.result.status, "Completed");
      assert.equal(status.payload.result.serviceBoardTomorrowDate, "");

      const replan = await requestJson(baseUrl, "/api/jobs/demo-job-1001/tomorrow", {
        method: "POST",
        body: JSON.stringify({ tomorrowDate: "2026-02-06" }),
      });
      assert.equal(replan.response.status, 200, replan.payload.error);

      const remove = await requestJson(baseUrl, "/api/jobs/demo-job-1001/tomorrow", { method: "DELETE" });
      assert.equal(remove.response.status, 200, remove.payload.error);
      assert.equal(remove.payload.result.serviceBoardTomorrowDate, "");
      assert.equal(remove.payload.result.scheduledDate, "");

      const createSecond = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customer: { id: "demo-customer-arcadia" },
          job: {
            id: "job-tomorrow-second",
            title: "Synthetic second tomorrow job",
            jobAddress: "10 Example Lane, Sampleton VIC 3000",
          },
        }),
      });
      assert.equal(createSecond.response.status, 200, createSecond.payload.error);

      await requestJson(baseUrl, "/api/jobs/demo-job-1001/tomorrow", {
        method: "POST",
        body: JSON.stringify({ tomorrowDate: "2026-02-07" }),
      });
      await requestJson(baseUrl, "/api/jobs/job-tomorrow-second/tomorrow", {
        method: "POST",
        body: JSON.stringify({ tomorrowDate: "2026-02-07" }),
      });
      const removeAll = await requestJson(baseUrl, "/api/jobs/tomorrow", {
        method: "DELETE",
        body: JSON.stringify({ tomorrowDate: "2026-02-07" }),
      });
      assert.equal(removeAll.response.status, 200, removeAll.payload.error);
      assert.equal(removeAll.payload.result.updatedCount, 2);
      assert.equal(removeAll.payload.state.jobs.filter((job) => job.serviceBoardTomorrowDate === "2026-02-07").length, 0);

      const state = getDbState(dbPath);
      assert.equal(state.jobs.find((job) => job.id === "demo-job-1001").status, "Completed");
    });
  });
});

test("job notes and photo metadata can be added and photo metadata can be deleted", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const note = await requestJson(baseUrl, "/api/jobs/demo-job-1001/notes", {
        method: "POST",
        body: JSON.stringify({
          id: "note-added-from-route",
          text: "Synthetic note added by route.",
        }),
      });

      assert.equal(note.response.status, 200, note.payload.error);
      assert.equal(note.payload.result.id, "note-added-from-route");
      assert.equal(note.payload.result.author, "Test Admin");

      const photo = await requestJson(baseUrl, "/api/jobs/demo-job-1001/photos", {
        method: "POST",
        body: JSON.stringify({
          id: "photo-added-from-route",
          name: "synthetic-photo.jpg",
          path: "uploads/synthetic-photo.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 1234,
        }),
      });

      assert.equal(photo.response.status, 200, photo.payload.error);
      assert.equal(photo.payload.result.id, "photo-added-from-route");

      const deletePhoto = await requestJson(baseUrl, "/api/jobs/demo-job-1001/photos/photo-added-from-route", { method: "DELETE" });
      assert.equal(deletePhoto.response.status, 200, deletePhoto.payload.error);

      const state = getDbState(dbPath);
      const job = state.jobs.find((entry) => entry.id === "demo-job-1001");
      assert.equal(job.notes.some((entry) => entry.id === "note-added-from-route"), true);
      assert.equal(job.photos.some((entry) => entry.id === "photo-added-from-route"), false);
    });
  });
});

test("job delete archives complete jobs and restore preserves documents while handling job-number conflicts", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const restorable = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customer: { id: "demo-customer-arcadia" },
          job: {
            id: "job-restorable-core",
            title: "Synthetic restorable core job",
            jobAddress: "10 Example Lane, Sampleton VIC 3000",
          },
        }),
      });
      assert.equal(restorable.response.status, 200, restorable.payload.error);
      assert.equal(restorable.payload.result.jobNumber, 1002);

      const deleteRestorable = await requestJson(baseUrl, "/api/jobs/job-restorable-core", { method: "DELETE" });
      assert.equal(deleteRestorable.response.status, 200, deleteRestorable.payload.error);

      const conflict = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customer: { id: "demo-customer-arcadia" },
          job: {
            id: "job-number-conflict",
            title: "Synthetic conflict job",
            jobAddress: "10 Example Lane, Sampleton VIC 3000",
          },
        }),
      });
      assert.equal(conflict.response.status, 200, conflict.payload.error);
      assert.equal(conflict.payload.result.jobNumber, 1002);

      const restored = await requestJson(baseUrl, "/api/jobs/job-restorable-core/restore", { method: "POST" });
      assert.equal(restored.response.status, 200, restored.payload.error);
      assert.equal(restored.payload.result.id, "job-restorable-core");
      assert.equal(restored.payload.result.jobNumber, 1003);

      const deleted = await requestJson(baseUrl, "/api/jobs/demo-job-1001", { method: "DELETE" });
      assert.equal(deleted.response.status, 200, deleted.payload.error);
      assert.equal(deleted.payload.state.jobs.some((job) => job.id === "demo-job-1001"), false);
      const archivedJob = deleted.payload.state.deletedJobs.find((entry) => entry.job.id === "demo-job-1001")?.job;
      assert.equal(Boolean(archivedJob?.quote), true);
      assert.equal(Boolean(archivedJob?.invoice), true);
      assert.equal(archivedJob.invoice.payments.length, 1);

      const restoredDocumentJob = await requestJson(baseUrl, "/api/jobs/demo-job-1001/restore", { method: "POST" });
      assert.equal(restoredDocumentJob.response.status, 200, restoredDocumentJob.payload.error);
      assert.equal(Boolean(restoredDocumentJob.payload.result.quote), true);
      assert.equal(Boolean(restoredDocumentJob.payload.result.invoice), true);
      assert.equal(restoredDocumentJob.payload.result.invoice.payments[0].id, "demo-payment-1");

      const deleteConflict = await requestJson(baseUrl, "/api/jobs/job-number-conflict", { method: "DELETE" });
      assert.equal(deleteConflict.response.status, 200, deleteConflict.payload.error);

      const emptied = await requestJson(baseUrl, "/api/deleted-jobs", { method: "DELETE" });
      assert.equal(emptied.response.status, 200, emptied.payload.error);
      assert.equal(emptied.payload.result.deletedCount, 1);
      assert.equal(emptied.payload.state.deletedJobs.length, 0);

      const state = getDbState(dbPath);
      assert.equal(state.jobs.some((job) => job.id === "job-restorable-core"), true);
      assert.equal(state.jobs.some((job) => job.id === "demo-job-1001"), true);
      assert.equal(state.jobs.find((job) => job.id === "demo-job-1001").invoice.payments.length, 1);
      assert.equal(state.deletedJobs.length, 0);
    });
  });
});

test("job routes reject invalid IDs, invalid relationships, invalid status, and roll back failed multi-table creates", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const missingCustomer = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customer: { id: "missing-customer" },
          job: {
            title: "Missing customer job",
            jobAddress: "10 Example Lane, Sampleton VIC 3000",
          },
        }),
      });
      assert.equal(missingCustomer.response.status, 404);

      const wrongSite = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customer: { id: "demo-customer-arcadia" },
          job: {
            title: "Wrong site job",
            jobAddress: "404 Wrong Street, Sampleton VIC 3000",
          },
        }),
      });
      assert.equal(wrongSite.response.status, 400);

      const missingStaff = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customer: { id: "demo-customer-arcadia" },
          job: {
            title: "Missing staff job",
            jobAddress: "10 Example Lane, Sampleton VIC 3000",
            assignedTechnicianId: "missing-staff",
          },
        }),
      });
      assert.equal(missingStaff.response.status, 400);

      const missingJob = await requestJson(baseUrl, "/api/jobs/missing-job", {
        method: "PATCH",
        body: JSON.stringify({ title: "No job" }),
      });
      assert.equal(missingJob.response.status, 404);

      const badStatus = await requestJson(baseUrl, "/api/jobs/demo-job-1001/status", {
        method: "PATCH",
        body: JSON.stringify({ status: "Not a status" }),
      });
      assert.equal(badStatus.response.status, 400);

      const rollback = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customer: { id: "demo-customer-arcadia" },
          siteInput: {
            id: "rollback-site",
            address: "88 Rollback Road, Sampleton VIC 3000",
            assets: [
              {
                id: "duplicate-asset",
                name: "First duplicate asset",
              },
              {
                id: "duplicate-asset",
                name: "Second duplicate asset",
              },
            ],
          },
          job: {
            id: "rollback-job",
            title: "Rollback job",
          },
        }),
      });
      assert.equal(rollback.response.status, 500);

      const state = getDbState(dbPath);
      assert.equal(state.jobs.some((job) => job.id === "rollback-job"), false);
      assert.equal(state.customers[0].sites.some((site) => site.id === "rollback-site"), false);
    });
  });
});

test("technicians can use limited status, notes, and photo routes but cannot manage jobs", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const deniedCreate = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customer: { id: "demo-customer-arcadia" },
          job: { title: "Denied create", jobAddress: "10 Example Lane, Sampleton VIC 3000" },
        }),
      });
      assert.equal(deniedCreate.response.status, 403);

      const deniedEdit = await requestJson(baseUrl, "/api/jobs/demo-job-1001", {
        method: "PATCH",
        body: JSON.stringify({ title: "Denied edit" }),
      });
      assert.equal(deniedEdit.response.status, 403);

      const deniedSchedule = await requestJson(baseUrl, "/api/jobs/demo-job-1001/schedule", {
        method: "PATCH",
        body: JSON.stringify({ scheduledDate: "2026-03-01" }),
      });
      assert.equal(deniedSchedule.response.status, 403);

      const deniedTomorrow = await requestJson(baseUrl, "/api/jobs/demo-job-1001/tomorrow", {
        method: "POST",
        body: JSON.stringify({ tomorrowDate: "2026-03-02" }),
      });
      assert.equal(deniedTomorrow.response.status, 403);

      const deniedDelete = await requestJson(baseUrl, "/api/jobs/demo-job-1001", { method: "DELETE" });
      assert.equal(deniedDelete.response.status, 403);

      const status = await requestJson(baseUrl, "/api/jobs/demo-job-1001/status", {
        method: "PATCH",
        body: JSON.stringify({ status: "In Progress" }),
      });
      assert.equal(status.response.status, 200, status.payload.error);

      const note = await requestJson(baseUrl, "/api/jobs/demo-job-1001/notes", {
        method: "POST",
        body: JSON.stringify({ text: "Technician synthetic note." }),
      });
      assert.equal(note.response.status, 200, note.payload.error);

      const photo = await requestJson(baseUrl, "/api/jobs/demo-job-1001/photos", {
        method: "POST",
        body: JSON.stringify({
          id: "technician-photo",
          name: "technician-photo.jpg",
        }),
      });
      assert.equal(photo.response.status, 200, photo.payload.error);

      const deletePhoto = await requestJson(baseUrl, "/api/jobs/demo-job-1001/photos/technician-photo", { method: "DELETE" });
      assert.equal(deletePhoto.response.status, 200, deletePhoto.payload.error);
    }, { role: "technician", username: "test-technician", name: "Test Technician" });
  });
});

test("job routes remain unavailable in JSON workspace mode", async () => {
  const tempDir = makeTempDir();
  const env = {
    ELSET_DATA_DIR: tempDir,
    ELSET_WORKSPACE_STORAGE: "json",
  };

  try {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          customer: { id: "demo-customer-arcadia" },
          job: { title: "JSON mode job", jobAddress: "10 Example Lane, Sampleton VIC 3000" },
        }),
      });
      assert.equal(result.response.status, 409);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
