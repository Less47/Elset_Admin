import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createSettingsRouter } from "../server-settings-routes.js";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { getAuthorizedWorkspaceState } from "../server-workspace-storage.js";
import { defaultInvoiceTemplate } from "../src/lib/quote-template.js";

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "elset-settings-routes-"));
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
  app.use(createSettingsRouter({
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

function getRawSettingRow(dbPath, key) {
  const db = openWorkspaceDb({ dbPath });
  try {
    return db.prepare("SELECT * FROM settings WHERE key = ?").get(key);
  } finally {
    db.close();
  }
}

test("SQLite loader and migration preserve safe workspace settings and omit secrets", async () => {
  const fixture = readFixture({
    settings: {
      companyName: "Synthetic Settings Co",
      companyEmail: "settings@example.test",
      defaultSenderEmail: "sender@example.test",
      workflowMode: "dense",
      serviceM8ApiKey: "do-not-store-this",
    },
  });

  await withTempWorkspace(async ({ env, dbPath }) => {
    const rawState = getDbState(dbPath);
    assert.equal(rawState.settings.companyName, "Synthetic Settings Co");
    assert.equal(rawState.settings.workflowMode, "dense");
    assert.equal(Object.prototype.hasOwnProperty.call(rawState.settings, "serviceM8ApiKey"), false);
    assert.equal(getRawSettingRow(dbPath, "serviceM8ApiKey"), undefined);

    const authorizedState = getAuthorizedWorkspaceState({ role: "admin" }, { env });
    assert.equal(authorizedState.settings.companyName, "Synthetic Settings Co");
    assert.equal(authorizedState.settings.workflowMode, "dense");
    assert.equal(Object.prototype.hasOwnProperty.call(authorizedState.settings, "serviceM8ApiKey"), false);
  }, fixture);
});

test("PATCH /api/settings updates business identity, contact, payment, and UI defaults", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            companyName: "Updated Synthetic Business",
            companyEmail: "office@example.test",
            companyPhone: "0400 000 900",
            companyAddress: "44 Example Road, Sampletown VIC 3000",
            bankAccountName: "Updated Synthetic Business",
            bankBsb: "123-456",
            bankAccountNumber: "123456789",
            defaultSenderEmail: "sender@example.test",
            replyToEmail: "reply@example.test",
            quoteCcEmail: "quotes@example.test",
            invoiceCcEmail: "invoices@example.test",
            emailSignature: "Regards,\nSynthetic Team",
            actionColor: "#abc",
            sidebarWidth: "compact",
            contentDensity: "compact",
            workflowMode: "field-first",
            lateFeePercent: 2.5,
            portalUrl: "https://example.test/client-portal",
          },
        }),
      });

      assert.equal(result.response.status, 200, result.payload.error);
      assert.deepEqual(result.payload.result.updatedKeys.sort(), [
        "actionColor",
        "bankAccountName",
        "bankAccountNumber",
        "bankBsb",
        "companyAddress",
        "companyEmail",
        "companyName",
        "companyPhone",
        "contentDensity",
        "defaultSenderEmail",
        "emailSignature",
        "invoiceCcEmail",
        "lateFeePercent",
        "portalUrl",
        "quoteCcEmail",
        "replyToEmail",
        "sidebarWidth",
        "workflowMode",
      ].sort());
      assert.equal(result.payload.state.settings.companyName, "Updated Synthetic Business");
      assert.equal(result.payload.state.settings.actionColor, "#AABBCC");
      assert.equal(result.payload.state.settings.lateFeePercent, 2.5);
      assert.equal(result.payload.state.settings.portalUrl, "https://example.test/client-portal");

      const state = getDbState(dbPath);
      assert.equal(state.settings.companyEmail, "office@example.test");
      assert.equal(state.settings.bankBsb, "123-456");
      assert.equal(state.settings.workflowMode, "field-first");
    });
  });
});

test("document template routes update and reset quote and invoice defaults", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const quoteResult = await requestJson(baseUrl, "/api/document-templates/quote", {
        method: "PUT",
        body: JSON.stringify({
          template: {
            accentColor: "#123456",
            quoteHeading: "Synthetic Quote Heading",
            introText: "Synthetic quote intro.",
            termsHeading: "Synthetic Quote Terms",
            termsText: "Synthetic quote terms text.",
            footerText: "Synthetic footer.",
            companyEmail: "documents@example.test",
            internalReferenceUrl: "https://example.test/template-reference",
          },
        }),
      });

      assert.equal(quoteResult.response.status, 200, quoteResult.payload.error);
      assert.equal(quoteResult.payload.result.type, "quote");
      assert.equal(quoteResult.payload.result.template.accentColor, "#123456");
      assert.equal(quoteResult.payload.result.template.internalReferenceUrl, "https://example.test/template-reference");
      assert.equal(quoteResult.payload.state.quoteTemplate.quoteHeading, "Synthetic Quote Heading");

      const resetResult = await requestJson(baseUrl, "/api/document-templates/invoice/reset", { method: "POST" });
      assert.equal(resetResult.response.status, 200, resetResult.payload.error);
      assert.equal(resetResult.payload.state.invoiceTemplate.termsText, defaultInvoiceTemplate.termsText);

      const state = getDbState(dbPath);
      assert.equal(state.quoteTemplate.quoteHeading, "Synthetic Quote Heading");
      assert.equal(state.invoiceTemplate.termsText, defaultInvoiceTemplate.termsText);
    });
  });
});

test("settings routes reject invalid emails, URLs, percentages, counters, and malformed bodies", async () => {
  await withTempWorkspace(async ({ env, dbPath }) => {
    await withServer(env, async (baseUrl) => {
      const rollback = await requestJson(baseUrl, "/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            companyName: "Should Not Persist",
            nextJobNumber: 1,
          },
        }),
      });
      assert.equal(rollback.response.status, 400);
      assert.equal(getDbState(dbPath).settings.companyName, "ELSET Demo Pty Ltd");

      const invalidEmail = await requestJson(baseUrl, "/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings: { companyEmail: "not-an-email" } }),
      });
      assert.equal(invalidEmail.response.status, 400);

      const invalidUrl = await requestJson(baseUrl, "/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings: { portalUrl: "not a url" } }),
      });
      assert.equal(invalidUrl.response.status, 400);

      const invalidPercent = await requestJson(baseUrl, "/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings: { gstRate: 150 } }),
      });
      assert.equal(invalidPercent.response.status, 400);

      const secret = await requestJson(baseUrl, "/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings: { smtpPassword: "secret" } }),
      });
      assert.equal(secret.response.status, 400);

      const malformed = await requestJson(baseUrl, "/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings: [] }),
      });
      assert.equal(malformed.response.status, 400);

      const badTemplate = await requestJson(baseUrl, "/api/document-templates/quote", {
        method: "PUT",
        body: JSON.stringify({ template: { accentColor: "blue" } }),
      });
      assert.equal(badTemplate.response.status, 400);
    });
  });
});

test("settings reset routes restore only the requested settings group", async () => {
  await withTempWorkspace(async ({ env }) => {
    await withServer(env, async (baseUrl) => {
      const update = await requestJson(baseUrl, "/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            companyName: "Reset Test Business",
            actionColor: "#112233",
            workflowMode: "keep-me",
          },
        }),
      });
      assert.equal(update.response.status, 200, update.payload.error);

      const resetUi = await requestJson(baseUrl, "/api/settings/reset", {
        method: "POST",
        body: JSON.stringify({ group: "ui" }),
      });
      assert.equal(resetUi.response.status, 200, resetUi.payload.error);
      assert.equal(resetUi.payload.state.settings.actionColor, "#F69320");
      assert.equal(resetUi.payload.state.settings.companyName, "Reset Test Business");
      assert.equal(resetUi.payload.state.settings.workflowMode, "keep-me");

      const resetPreferences = await requestJson(baseUrl, "/api/settings/reset", {
        method: "POST",
        body: JSON.stringify({ group: "preferences" }),
      });
      assert.equal(resetPreferences.response.status, 200, resetPreferences.payload.error);
      assert.equal(resetPreferences.payload.state.settings.companyName, "Elset");
      assert.equal(resetPreferences.payload.state.settings.workflowMode, "keep-me");
    });
  });
});

test("settings routes enforce permissions, preserve JSON mode, and leave auth records untouched", async () => {
  await withTempWorkspace(async ({ env, tempDir }) => {
    await withServer(env, async (baseUrl) => {
      const officeResult = await requestJson(baseUrl, "/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings: { companyPhone: "0400 000 901" } }),
      });
      assert.equal(officeResult.response.status, 200, officeResult.payload.error);
    }, { role: "office", staffId: "" });

    await withServer(env, async (baseUrl) => {
      const technicianResult = await requestJson(baseUrl, "/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings: { companyPhone: "0400 000 902" } }),
      });
      assert.equal(technicianResult.response.status, 403);
    }, { role: "technician" });

    assert.equal(fs.existsSync(path.join(tempDir, "auth.db")), false);
  });

  const tempDir = makeTempDir();
  const env = {
    ELSET_DATA_DIR: tempDir,
    ELSET_WORKSPACE_STORAGE: "json",
  };

  try {
    await withServer(env, async (baseUrl) => {
      const result = await requestJson(baseUrl, "/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings: { companyName: "JSON Mode Business" } }),
      });
      assert.equal(result.response.status, 409);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
