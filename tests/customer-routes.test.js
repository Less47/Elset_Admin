import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createCustomerRouter } from "../server-customer-routes.js";
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "elset-customer-routes-"));
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

function buildApp(env) {
  const app = express();
  app.use(express.json());
  app.use(createCustomerRouter({
    env,
    requireAuth: (req, _res, next) => {
      req.user = {
        id: "test-admin",
        role: "admin",
        username: "test-admin",
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

async function withServer(env, callback) {
  const app = buildApp(env);
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

test("POST /api/customers creates a customer with contacts, site, asset, and access note", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const { response, payload } = await requestJson(baseUrl, "/api/customers", {
        method: "POST",
        body: JSON.stringify({
          name: "Example Facilities",
          email: "accounts@example-facilities.test",
          phone: "0400 111 000",
          customerType: "business",
          address: "44 Example Road, Sampletown VIC 3000",
          contacts: [
            {
              id: "contact-facilities-manager",
              name: "Morgan Example",
              role: "Facilities Manager",
              email: "morgan@example-facilities.test",
            },
          ],
          sites: [
            {
              id: "site-example-yard",
              address: "44 Example Road, Sampletown VIC 3000",
              siteType: "commercial",
              accessNotes: "Synthetic access note.",
              contactName: "Morgan Example",
              contactEmail: "morgan@example-facilities.test",
              assets: [
                {
                  id: "asset-example-gate",
                  name: "Synthetic sliding gate",
                  type: "Sliding Gate",
                },
              ],
            },
          ],
        }),
      });

      assert.equal(response.status, 200, payload.error);
      assert.equal(payload.result.name, "Example Facilities");
      assert.ok(payload.state.customers.some((customer) => customer.id === payload.result.id));

      const state = getDbState(dbPath);
      const customer = state.customers.find((entry) => entry.id === payload.result.id);
      assert.equal(customer.contacts.some((contact) => contact.id === "contact-facilities-manager"), true);
      assert.equal(customer.sites[0].assets[0].id, "asset-example-gate");
      assert.equal(customer.siteAccessNotes[0].notes, "Synthetic access note.");
    });
  });
});

test("PATCH /api/customers/:id updates customer fields and related job snapshots", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const { response, payload } = await requestJson(baseUrl, "/api/customers/demo-customer-arcadia", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Arcadia Updated Owners",
          email: "updated@example.test",
          phone: "0400 999 999",
        }),
      });

      assert.equal(response.status, 200, payload.error);
      const job = payload.state.jobs.find((entry) => entry.id === "demo-job-1001");
      assert.equal(job.customerName, "Arcadia Updated Owners");
      assert.equal(job.customerEmail, "updated@example.test");
      assert.equal(job.customerPhone, "0400 999 999");

      const state = getDbState(dbPath);
      assert.equal(state.jobs.find((entry) => entry.id === "demo-job-1001").customerName, "Arcadia Updated Owners");
    });
  });
});

test("DELETE /api/customers/:id archives the customer and related jobs, then restore brings back only the customer", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const deleteResult = await requestJson(baseUrl, "/api/customers/demo-customer-arcadia", { method: "DELETE" });
      assert.equal(deleteResult.response.status, 200, deleteResult.payload.error);
      assert.equal(deleteResult.payload.result.deletedJobCount, 1);
      assert.equal(deleteResult.payload.state.customers.some((customer) => customer.id === "demo-customer-arcadia"), false);
      assert.equal(deleteResult.payload.state.jobs.some((job) => job.id === "demo-job-1001"), false);
      assert.equal(deleteResult.payload.state.deletedCustomers.length, 1);
      assert.equal(deleteResult.payload.state.deletedJobs.length, 1);

      const restoreResult = await requestJson(baseUrl, "/api/customers/demo-customer-arcadia/restore", { method: "POST" });
      assert.equal(restoreResult.response.status, 200, restoreResult.payload.error);
      assert.equal(restoreResult.payload.state.customers.some((customer) => customer.id === "demo-customer-arcadia"), true);
      assert.equal(restoreResult.payload.state.jobs.some((job) => job.id === "demo-job-1001"), false);

      const state = getDbState(dbPath);
      assert.equal(state.customers.some((customer) => customer.id === "demo-customer-arcadia"), true);
      assert.equal(state.jobs.some((job) => job.id === "demo-job-1001"), false);
    });
  });
});

test("site update syncs matching job and maintenance-plan addresses", async () => {
  const fixture = readFixture({
    maintenancePlans: [
      {
        id: "demo-maintenance-plan",
        planName: "Synthetic recurring service",
        customerId: "demo-customer-arcadia",
        siteAddress: "10 Example Lane, Sampleton VIC 3000",
        frequency: "quarterly",
        nextDueDate: "2026-02-01",
        defaultTechnicianId: "",
        estimatedDurationHours: 1,
        contractPrice: 100,
        checklist: ["Synthetic checklist item"],
        notes: "",
        lastGeneratedAt: "",
        lastGeneratedJobId: "",
        lastCompletedAt: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const { response, payload } = await requestJson(
        baseUrl,
        "/api/customers/demo-customer-arcadia/sites/demo-site-front-entry",
        {
          method: "PATCH",
          body: JSON.stringify({
            site: {
              address: "55 Updated Lane, Sampleton VIC 3000",
              accessNotes: "Updated synthetic note.",
            },
            previousAddress: "10 Example Lane, Sampleton VIC 3000",
          }),
        }
      );

      assert.equal(response.status, 200, payload.error);
      assert.equal(payload.state.jobs.find((job) => job.id === "demo-job-1001").jobAddress, "55 Updated Lane, Sampleton VIC 3000");
      assert.equal(payload.state.maintenancePlans.find((plan) => plan.id === "demo-maintenance-plan").siteAddress, "55 Updated Lane, Sampleton VIC 3000");

      const state = getDbState(dbPath);
      assert.equal(state.customers[0].sites[0].address, "55 Updated Lane, Sampleton VIC 3000");
    });
  }, fixture);
});

test("site create and delete endpoints update only customer site records", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const createResult = await requestJson(baseUrl, "/api/customers/demo-customer-arcadia/sites", {
        method: "POST",
        body: JSON.stringify({
          id: "demo-site-side-entry",
          address: "12 Side Street, Sampleton VIC 3000",
          siteType: "residential",
          accessNotes: "Side gate code is synthetic.",
        }),
      });
      assert.equal(createResult.response.status, 200, createResult.payload.error);
      assert.equal(createResult.payload.state.customers[0].sites.some((site) => site.id === "demo-site-side-entry"), true);

      const deleteResult = await requestJson(
        baseUrl,
        "/api/customers/demo-customer-arcadia/sites/demo-site-side-entry",
        { method: "DELETE" }
      );
      assert.equal(deleteResult.response.status, 200, deleteResult.payload.error);
      assert.equal(deleteResult.payload.state.customers[0].sites.some((site) => site.id === "demo-site-side-entry"), false);
      assert.equal(deleteResult.payload.state.jobs.some((job) => job.id === "demo-job-1001"), true);
    });
  });
});

test("customer endpoints reject invalid or missing IDs", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const missingCustomer = await requestJson(baseUrl, "/api/customers/missing-customer", {
        method: "PATCH",
        body: JSON.stringify({ name: "Nobody" }),
      });
      assert.equal(missingCustomer.response.status, 404);

      const missingSite = await requestJson(baseUrl, "/api/customers/demo-customer-arcadia/sites/missing-site", {
        method: "PATCH",
        body: JSON.stringify({ address: "1 Nowhere Street, Example VIC 3000" }),
      });
      assert.equal(missingSite.response.status, 404);
    });
  });
});

test("multi-table site create rolls back when a related insert fails", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/customers/demo-customer-arcadia/sites", {
        method: "POST",
        body: JSON.stringify({
          id: "demo-site-rollback",
          address: "99 Rollback Road, Sampleton VIC 3000",
          assets: [
            {
              id: "duplicate-asset-id",
              name: "First duplicate asset",
            },
            {
              id: "duplicate-asset-id",
              name: "Second duplicate asset",
            },
          ],
        }),
      });

      assert.equal(result.response.status, 500);
      const state = getDbState(dbPath);
      const customer = state.customers.find((entry) => entry.id === "demo-customer-arcadia");
      assert.equal(customer.sites.some((site) => site.id === "demo-site-rollback"), false);
    });
  });
});
