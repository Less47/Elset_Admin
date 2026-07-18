import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createInventoryRouter } from "../server-inventory-routes.js";
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

function inventoryItem(overrides = {}) {
  return {
    id: "inventory-test-item",
    name: "Synthetic inventory motor",
    sku: "INV-SYN-MOTOR",
    category: "Automation",
    supplier: "Synthetic Supplier",
    location: "Demo shelf",
    quantity: 5,
    reorderLevel: 2,
    unitCost: 125.45,
    salePrice: 220,
    partNumber: "PART-SYN-001",
    description: "Synthetic item description.",
    active: true,
    notes: "Synthetic inventory notes.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "elset-inventory-routes-"));
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
  app.use(createInventoryRouter({
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

test("POST /api/inventory-items creates an inventory item and preserves optional fields", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/inventory-items", {
        method: "POST",
        body: JSON.stringify({
          item: inventoryItem(),
        }),
      });

      assert.equal(result.response.status, 200, result.payload.error);
      assert.equal(result.payload.result.id, "inventory-test-item");
      assert.equal(result.payload.result.name, "Synthetic inventory motor");
      assert.equal(result.payload.result.quantity, 5);
      assert.equal(result.payload.result.unitCost, 125.45);
      assert.equal(result.payload.result.salePrice, 220);
      assert.equal(result.payload.result.partNumber, "PART-SYN-001");
      assert.equal(result.payload.result.description, "Synthetic item description.");
      assert.equal(result.payload.state.inventoryItems.some((item) => item.id === "inventory-test-item"), true);

      const state = getDbState(dbPath);
      assert.equal(state.inventoryItems.some((item) => item.id === "inventory-test-item"), true);
    });
  });
});

test("PATCH /api/inventory-items/:id edits all supported fields and stock quantity", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/inventory-items/demo-inventory-controller", {
        method: "PATCH",
        body: JSON.stringify({
          item: {
            name: "Edited synthetic controller",
            sku: "DEMO-CONTROLLER-EDITED",
            category: "Electrical",
            supplier: "Edited Supplier",
            location: "Edited shelf",
            quantity: 7.5,
            reorderLevel: 3.25,
            unitCost: 101.23,
            salePrice: 180.5,
            partNumber: "PART-EDITED",
            description: "Edited description.",
            active: false,
            notes: "Edited notes.",
          },
        }),
      });

      assert.equal(result.response.status, 200, result.payload.error);
      assert.equal(result.payload.result.name, "Edited synthetic controller");
      assert.equal(result.payload.result.sku, "DEMO-CONTROLLER-EDITED");
      assert.equal(result.payload.result.category, "Electrical");
      assert.equal(result.payload.result.quantity, 7.5);
      assert.equal(result.payload.result.reorderLevel, 3.25);
      assert.equal(result.payload.result.unitCost, 101.23);
      assert.equal(result.payload.result.salePrice, 180.5);
      assert.equal(result.payload.result.active, false);

      const state = getDbState(dbPath);
      const item = state.inventoryItems.find((entry) => entry.id === "demo-inventory-controller");
      assert.equal(item.quantity, 7.5);
      assert.equal(item.notes, "Edited notes.");
    });
  });
});

test("inventory routes validate missing fields, invalid numbers, and missing IDs", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const missingName = await requestJson(baseUrl, "/api/inventory-items", {
        method: "POST",
        body: JSON.stringify({
          item: inventoryItem({ id: "missing-name", name: "" }),
        }),
      });
      assert.equal(missingName.response.status, 400);

      const invalidQuantity = await requestJson(baseUrl, "/api/inventory-items", {
        method: "POST",
        body: JSON.stringify({
          item: inventoryItem({ id: "invalid-quantity", quantity: -1 }),
        }),
      });
      assert.equal(invalidQuantity.response.status, 400);

      const invalidCost = await requestJson(baseUrl, "/api/inventory-items", {
        method: "POST",
        body: JSON.stringify({
          item: inventoryItem({ id: "invalid-cost", unitCost: "not-money" }),
        }),
      });
      assert.equal(invalidCost.response.status, 400);

      const invalidSalePrice = await requestJson(baseUrl, "/api/inventory-items", {
        method: "POST",
        body: JSON.stringify({
          item: inventoryItem({ id: "invalid-sale-price", salePrice: -10 }),
        }),
      });
      assert.equal(invalidSalePrice.response.status, 400);

      const missingItem = await requestJson(baseUrl, "/api/inventory-items/missing-item", {
        method: "PATCH",
        body: JSON.stringify({
          item: { quantity: 1 },
        }),
      });
      assert.equal(missingItem.response.status, 404);
    });
  });
});

test("inventory routes preserve existing duplicate SKU behaviour", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const first = await requestJson(baseUrl, "/api/inventory-items", {
        method: "POST",
        body: JSON.stringify({
          item: inventoryItem({ id: "duplicate-sku-one", sku: "DUPLICATE-SKU" }),
        }),
      });
      assert.equal(first.response.status, 200, first.payload.error);

      const second = await requestJson(baseUrl, "/api/inventory-items", {
        method: "POST",
        body: JSON.stringify({
          item: inventoryItem({ id: "duplicate-sku-two", sku: "DUPLICATE-SKU" }),
        }),
      });
      assert.equal(second.response.status, 200, second.payload.error);
      assert.equal(second.payload.state.inventoryItems.filter((item) => item.sku === "DUPLICATE-SKU").length, 2);
    });
  });
});

test("inventory item delete archives the item and restore brings it back", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const deleted = await requestJson(baseUrl, "/api/inventory-items/demo-inventory-controller", { method: "DELETE" });
      assert.equal(deleted.response.status, 200, deleted.payload.error);
      assert.equal(deleted.payload.state.inventoryItems.some((item) => item.id === "demo-inventory-controller"), false);

      const restored = await requestJson(baseUrl, "/api/inventory-items/demo-inventory-controller/restore", { method: "POST" });
      assert.equal(restored.response.status, 200, restored.payload.error);
      assert.equal(restored.payload.result.id, "demo-inventory-controller");
      assert.equal(restored.payload.state.inventoryItems.some((item) => item.id === "demo-inventory-controller"), true);

      const state = getDbState(dbPath);
      assert.equal(state.inventoryItems.some((item) => item.id === "demo-inventory-controller"), true);
    });
  });
});

test("deleting inventory does not corrupt historical job or document references", async () => {
  const fixture = readFixture();
  fixture.jobs = fixture.jobs.map((job) => (
    job.id === "demo-job-1001"
      ? {
          ...job,
          description: `${job.description} Uses inventory demo-inventory-controller.`,
          quote: {
            ...job.quote,
            items: [
              {
                id: "quote-inventory-reference",
                description: "Install DEMO-CONTROLLER from inventory",
                qty: 1,
                rate: 100,
              },
            ],
          },
          invoice: {
            ...job.invoice,
            items: [
              {
                id: "invoice-inventory-reference",
                description: "Install DEMO-CONTROLLER from inventory",
                qty: 1,
                rate: 100,
              },
            ],
          },
        }
      : job
  ));

  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const deleted = await requestJson(baseUrl, "/api/inventory-items/demo-inventory-controller", { method: "DELETE" });
      assert.equal(deleted.response.status, 200, deleted.payload.error);

      const state = getDbState(dbPath);
      const job = state.jobs.find((entry) => entry.id === "demo-job-1001");
      assert.match(job.description, /demo-inventory-controller/);
      assert.equal(job.quote.items[0].description, "Install DEMO-CONTROLLER from inventory");
      assert.equal(job.invoice.items[0].description, "Install DEMO-CONTROLLER from inventory");
    });
  }, fixture);
});

test("inventory delete rolls back when the archive write fails", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    const db = openWorkspaceDb({ dbPath });
    try {
      db.prepare(`
        INSERT INTO deleted_inventory_items (id, item_id, deleted_at, payload_json, extra_json)
        VALUES ('deleted-inventory-item:demo-inventory-controller', 'demo-inventory-controller', '2026-01-01T00:00:00.000Z', '{}', '{}')
      `).run();
    } finally {
      db.close();
    }

    await withServer(env, async (baseUrl) => {
      const deleted = await requestJson(baseUrl, "/api/inventory-items/demo-inventory-controller", { method: "DELETE" });
      assert.equal(deleted.response.status, 500);
      const state = getDbState(dbPath);
      assert.equal(state.inventoryItems.some((item) => item.id === "demo-inventory-controller"), true);
    });
  });
});

test("inventory routes reject technicians and stay unavailable in JSON mode", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/inventory-items", {
        method: "POST",
        body: JSON.stringify({
          item: inventoryItem({ id: "technician-inventory-item" }),
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
      const result = await requestJson(baseUrl, "/api/inventory-items", {
        method: "POST",
        body: JSON.stringify({
          item: inventoryItem({ id: "json-mode-inventory-item" }),
        }),
      });
      assert.equal(result.response.status, 409);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
