import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServiceM8ImportRouter } from "../server-servicem8-import-routes.js";
import { applyServiceM8ImportPlanToSqlite } from "../server-workspace-servicem8-import.js";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const workspaceFixturePath = path.join(repoRoot, "fixtures", "demo-workspace.json");
const serviceM8FixturePath = path.join(repoRoot, "fixtures", "servicem8-import-snapshot.json");

const endpointMap = new Map([
  ["company.json", "clients"],
  ["companycontact.json", "contacts"],
  ["job.json", "jobs"],
  ["jobactivity.json", "activities"],
  ["jobmaterial.json", "materials"],
  ["jobpayment.json", "payments"],
  ["note.json", "notes"],
  ["staff.json", "staff"],
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readWorkspaceFixture(overrides = {}) {
  return {
    ...readJson(workspaceFixturePath),
    ...overrides,
  };
}

function readServiceM8Fixture(overrides = {}) {
  return {
    ...readJson(serviceM8FixturePath),
    ...overrides,
  };
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "elset-servicem8-import-"));
}

async function withTempWorkspace(callback, fixture = null) {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "elset-workspace.db");
  const authPath = path.join(tempDir, "auth.db");
  fs.writeFileSync(authPath, "synthetic auth db must not be touched", "utf8");
  const db = openWorkspaceDb({ dbPath });
  if (fixture) {
    importWorkspaceJsonData(db, fixture);
  }
  db.close();

  const env = {
    ELSET_DATA_DIR: tempDir,
    ELSET_WORKSPACE_STORAGE: "sqlite",
  };

  try {
    return await callback({ tempDir, dbPath, authPath, env });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildApp(env, user = {}, routeOptions = {}) {
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use(createServiceM8ImportRouter({
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
    ...routeOptions,
  }));
  return app;
}

async function withServer(env, callback, user = {}, routeOptions = {}) {
  const app = buildApp(env, user, routeOptions);
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

async function withMockedServiceM8(snapshot, callback) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options) => {
    const parsedUrl = new URL(String(url));
    if (parsedUrl.hostname !== "api.servicem8.com") {
      return originalFetch(url, options);
    }
    const endpoint = parsedUrl.pathname.split("/").pop();
    const key = endpointMap.get(endpoint);
    calls.push({ endpoint, key, cursor: parsedUrl.searchParams.get("cursor") });
    if (!key) {
      return new Response(JSON.stringify({ message: "Unexpected synthetic endpoint." }), {
        status: 404,
        headers: { "Content-Type": "application/json", "x-next-cursor": "" },
      });
    }

    const payload = snapshot[key];
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json", "x-next-cursor": "" },
    });
  };

  try {
    return await callback(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function getDbState(dbPath) {
  const db = openWorkspaceDb({ dbPath });
  try {
    return loadWorkspaceStateFromDb(db);
  } finally {
    db.close();
  }
}

function getServiceM8RefCount(dbPath) {
  const db = openWorkspaceDb({ dbPath });
  try {
    return db.prepare("SELECT COUNT(*) AS count FROM service_m8_refs").get().count;
  } finally {
    db.close();
  }
}

test("SQLite ServiceM8 import writes customers, sites, jobs, notes, documents, payments, and sent history transactionally", async () => {
  await withTempWorkspace(async ({ env, dbPath, authPath }) => {
    const authBefore = fs.readFileSync(authPath, "utf8");
    await withMockedServiceM8(readServiceM8Fixture(), async () => {
      await withServer(env, async (baseUrl) => {
        const preview = await requestJson(baseUrl, "/api/admin/servicem8-import/preview", {
          method: "POST",
          body: JSON.stringify({ apiKey: "synthetic-api-key" }),
        });
        assert.equal(preview.response.status, 200, preview.payload.error || JSON.stringify(preview.payload));
        assert.equal(preview.payload.summary.customers.create, 1);
        assert.equal(preview.payload.summary.jobs.create, 1);

        const apply = await requestJson(baseUrl, "/api/admin/servicem8-import/apply", {
          method: "POST",
          body: JSON.stringify({ previewId: preview.payload.previewId }),
        });

        assert.equal(apply.response.status, 200, apply.payload.error || JSON.stringify(apply.payload));
        assert.equal(apply.payload.summary.apply.customers.created, 1);
        assert.equal(apply.payload.summary.apply.customers.failed, 0);
        assert.equal(apply.payload.summary.apply.jobs.created, 1);
        assert.equal(apply.payload.summary.apply.jobs.failed, 0);
        assert.equal(apply.payload.summary.apply.documents.quotesCreated, 1);
        assert.equal(apply.payload.summary.apply.documents.invoicesCreated, 1);
        assert.equal(apply.payload.summary.apply.documents.paymentsCreated, 1);
        assert.equal(apply.payload.summary.apply.documents.sentHistoryCreated, 2);

        const state = getDbState(dbPath);
        const importedCustomer = state.customers.find((customer) => customer.id === "servicem8-company-svc-company-alpha");
        const importedJob = state.jobs.find((job) => job.id === "servicem8-job-svc-job-alpha");
        assert.equal(importedCustomer.name, "Synthetic ServiceM8 Customer");
        assert.equal(importedCustomer.sites.length, 2);
        assert.equal(importedJob.customerId, importedCustomer.id);
        assert.equal(importedJob.notes[0].text, "Synthetic ServiceM8 note copied into the job.");
        assert.equal(importedJob.quote.items.length, 2);
        assert.equal(importedJob.quote.sentHistory.length, 1);
        assert.equal(importedJob.invoice.payments[0].id, "servicem8-payment-svc-payment-alpha");
        assert.equal(importedJob.invoice.sentHistory.length, 1);
        assert.equal(Object.prototype.hasOwnProperty.call(state.settings || {}, "serviceM8ApiKey"), false);
        assert.equal(getServiceM8RefCount(dbPath), 2);
        assert.equal(fs.readFileSync(authPath, "utf8"), authBefore);
      });
    });
  });
});

test("SQLite ServiceM8 import updates records when the ServiceM8 source edit date advances", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      await withMockedServiceM8(readServiceM8Fixture(), async () => {
        const first = await requestJson(baseUrl, "/api/admin/servicem8-import/apply", {
          method: "POST",
          body: JSON.stringify({ apiKey: "synthetic-api-key" }),
        });
        assert.equal(first.response.status, 200, first.payload.error || JSON.stringify(first.payload));
      });

      const updatedSnapshot = readServiceM8Fixture({
        clients: readServiceM8Fixture().clients.map((client) => (
          client.uuid === "svc-company-alpha"
            ? {
                ...client,
                name: "Synthetic ServiceM8 Customer Updated",
                edit_date: "2026-06-01 09:00:00",
              }
            : client
        )),
        jobs: readServiceM8Fixture().jobs.map((job) => ({
          ...job,
          job_description: "Synthetic ServiceM8 updated gate service",
          edit_date: "2026-06-01 10:00:00",
        })),
      });

      await withMockedServiceM8(updatedSnapshot, async () => {
        const updated = await requestJson(baseUrl, "/api/admin/servicem8-import/apply", {
          method: "POST",
          body: JSON.stringify({ apiKey: "synthetic-api-key" }),
        });
        assert.equal(updated.response.status, 200, updated.payload.error || JSON.stringify(updated.payload));
        assert.equal(updated.payload.summary.apply.customers.updated, 1);
        assert.equal(updated.payload.summary.apply.jobs.updated, 1);
      });

      const state = getDbState(dbPath);
      assert.equal(state.customers.find((customer) => customer.id === "servicem8-company-svc-company-alpha").name, "Synthetic ServiceM8 Customer Updated");
      assert.equal(state.jobs.find((job) => job.id === "servicem8-job-svc-job-alpha").title, "Synthetic ServiceM8 updated gate service");
    });
  });
});

test("SQLite ServiceM8 import preserves unrelated records and repeated imports are idempotent", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withMockedServiceM8(readServiceM8Fixture(), async () => {
      await withServer(env, async (baseUrl) => {
        const first = await requestJson(baseUrl, "/api/admin/servicem8-import/apply", {
          method: "POST",
          body: JSON.stringify({ apiKey: "synthetic-api-key" }),
        });
        assert.equal(first.response.status, 200, first.payload.error || JSON.stringify(first.payload));

        const second = await requestJson(baseUrl, "/api/admin/servicem8-import/apply", {
          method: "POST",
          body: JSON.stringify({ apiKey: "synthetic-api-key" }),
        });
        assert.equal(second.response.status, 200, second.payload.error || JSON.stringify(second.payload));
        assert.equal(second.payload.summary.apply.customers.skipped, 1);
        assert.equal(second.payload.summary.apply.jobs.skipped, 1);

        const state = getDbState(dbPath);
        assert.equal(state.customers.filter((customer) => customer.id === "servicem8-company-svc-company-alpha").length, 1);
        assert.equal(state.jobs.filter((job) => job.id === "servicem8-job-svc-job-alpha").length, 1);
        assert.equal(state.customers.some((customer) => customer.id === "demo-customer-arcadia"), true);
        assert.equal(state.jobs.some((job) => job.id === "demo-job-1001"), true);
      });
    });
  }, readWorkspaceFixture());
});

test("SQLite ServiceM8 import reports conflicts instead of overwriting newer local edits", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withMockedServiceM8(readServiceM8Fixture(), async () => {
      await withServer(env, async (baseUrl) => {
        const first = await requestJson(baseUrl, "/api/admin/servicem8-import/apply", {
          method: "POST",
          body: JSON.stringify({ apiKey: "synthetic-api-key" }),
        });
        assert.equal(first.response.status, 200, first.payload.error || JSON.stringify(first.payload));

        const db = openWorkspaceDb({ dbPath });
        db.prepare(`
          UPDATE customers
             SET name = 'Local edited ServiceM8 customer',
                 updated_at = '2026-05-01T00:00:00.000Z'
           WHERE id = 'servicem8-company-svc-company-alpha'
        `).run();
        db.prepare(`
          UPDATE jobs
             SET title = 'Local edited ServiceM8 job',
                 updated_at = '2026-05-01T00:00:00.000Z'
           WHERE id = 'servicem8-job-svc-job-alpha'
        `).run();
        db.close();

        const second = await requestJson(baseUrl, "/api/admin/servicem8-import/apply", {
          method: "POST",
          body: JSON.stringify({ apiKey: "synthetic-api-key" }),
        });
        assert.equal(second.response.status, 200, second.payload.error || JSON.stringify(second.payload));
        assert.equal(second.payload.summary.apply.customers.conflicted, 1);
        assert.equal(second.payload.summary.apply.jobs.conflicted, 1);

        const state = getDbState(dbPath);
        assert.equal(state.customers.find((customer) => customer.id === "servicem8-company-svc-company-alpha").name, "Local edited ServiceM8 customer");
        assert.equal(state.jobs.find((job) => job.id === "servicem8-job-svc-job-alpha").title, "Local edited ServiceM8 job");
      });
    });
  });
});

test("SQLite ServiceM8 import dry-run validates without writing", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withMockedServiceM8(readServiceM8Fixture(), async () => {
      await withServer(env, async (baseUrl) => {
        const dryRun = await requestJson(baseUrl, "/api/admin/servicem8-import/apply", {
          method: "POST",
          body: JSON.stringify({ apiKey: "synthetic-api-key", dryRun: true }),
        });
        assert.equal(dryRun.response.status, 200, dryRun.payload.error || JSON.stringify(dryRun.payload));
        assert.equal(dryRun.payload.dryRun, true);
        assert.equal(dryRun.payload.summary.apply.customers.created, 1);

        const state = getDbState(dbPath);
        assert.equal(state.customers.length, 0);
        assert.equal(state.jobs.length, 0);
      });
    });
  });
});

test("SQLite ServiceM8 import rejects malformed provider payloads without writing", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withMockedServiceM8(readServiceM8Fixture({ jobs: { malformed: true } }), async () => {
      await withServer(env, async (baseUrl) => {
        const apply = await requestJson(baseUrl, "/api/admin/servicem8-import/apply", {
          method: "POST",
          body: JSON.stringify({ apiKey: "synthetic-api-key" }),
        });
        assert.equal(apply.response.status, 400);
        assert.match(apply.payload.error, /jobs response was not a list/i);

        const state = getDbState(dbPath);
        assert.equal(state.customers.length, 0);
        assert.equal(state.jobs.length, 0);
      });
    });
  });
});

test("SQLite ServiceM8 import rejects broken relationships and rolls back failed mid-import writes", async () => {
  await withTempWorkspace(async ({ dbPath }) => {
    const db = openWorkspaceDb({ dbPath });
    const brokenRelationshipPlan = {
      importedAt: "2026-02-06T00:00:00.000Z",
      summary: {},
      customers: [],
      jobs: [
        {
          action: "create",
          record: {
            id: "servicem8-job-broken",
            title: "Broken synthetic job",
            status: "To Do",
            customerId: "missing-customer",
            jobAddress: "99 Missing Street, Sampleville VIC 3001",
            notes: [],
            photos: [],
          },
        },
      ],
    };

    assert.throws(
      () => applyServiceM8ImportPlanToSqlite(db, brokenRelationshipPlan),
      /references missing customer/
    );

    const invalidLineItemPlan = {
      ...brokenRelationshipPlan,
      customers: [
        {
          action: "create",
          record: {
            id: "servicem8-company-rollback",
            name: "Rollback Customer",
            address: "88 Rollback Street, Sampleville VIC 3001",
            sites: [{ id: "servicem8-site-rollback", address: "88 Rollback Street, Sampleville VIC 3001" }],
            externalRefs: {
              serviceM8: {
                companyUuid: "svc-company-rollback",
                editDate: "2026-02-01 00:00:00",
              },
            },
          },
        },
      ],
      jobs: [
        {
          action: "create",
          record: {
            id: "servicem8-job-rollback",
            title: "Rollback synthetic job",
            status: "To Do",
            customerId: "servicem8-company-rollback",
            customerName: "Rollback Customer",
            jobAddress: "88 Rollback Street, Sampleville VIC 3001",
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
            notes: [],
            photos: [],
            invoice: {
              type: "invoice",
              issueDate: "2026-02-01",
              dueDate: "2026-02-08",
              items: [{ id: "bad-line", description: "Bad line", qty: "not-a-number", rate: 100 }],
              payments: [],
              sentHistory: [],
            },
          },
        },
      ],
    };

    assert.throws(
      () => applyServiceM8ImportPlanToSqlite(db, invalidLineItemPlan),
      /Line item quantity must be a valid number/
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM customers").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count, 0);
    db.close();
  });
});

test("ServiceM8 import endpoint rejects technicians", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const response = await requestJson(baseUrl, "/api/admin/servicem8-import/apply", {
        method: "POST",
        body: JSON.stringify({ apiKey: "synthetic-api-key" }),
      });

      assert.equal(response.response.status, 403);
      assert.equal(getDbState(dbPath).customers.length, 0);
    }, { role: "technician" });
  });
});

test("JSON mode ServiceM8 import keeps the legacy merge-and-save path", async () => {
  const snapshot = readServiceM8Fixture();
  let savedState = null;
  const initialState = readWorkspaceFixture({
    customers: [],
    jobs: [],
  });
  const routeOptions = {
    loadWorkspaceStateFn: () => initialState,
    saveWorkspaceStateFn: (nextData) => {
      savedState = nextData;
      return nextData;
    },
    getAuthorizedWorkspaceStateFn: () => savedState || initialState,
  };

  await withMockedServiceM8(snapshot, async () => {
    await withServer({ ELSET_WORKSPACE_STORAGE: "json" }, async (baseUrl) => {
      const apply = await requestJson(baseUrl, "/api/admin/servicem8-import/apply", {
        method: "POST",
        body: JSON.stringify({ apiKey: "synthetic-api-key" }),
      });

      assert.equal(apply.response.status, 200, apply.payload.error || JSON.stringify(apply.payload));
      assert.equal(savedState.customers.length, 1);
      assert.equal(savedState.jobs.length, 1);
      assert.equal(apply.payload.state.customers[0].id, "servicem8-company-svc-company-alpha");
    }, {}, routeOptions);
  });
});
