import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import sharp from "sharp";
import { createWorkspaceLogoRouter } from "../server-workspace-logo-routes.js";
import { validateWorkspaceLogo, saveWorkspaceLogo, readWorkspaceLogo, validateWorkspaceBrandingAsset, saveWorkspaceBrandingAsset, readWorkspaceBrandingAsset } from "../server-workspace-logo.js";
import { updateWorkspaceSettings } from "../server-workspace-settings.js";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { createWorkspaceSqliteBackup, createWorkspaceSqliteBackupBundle, materializeWorkspaceSqliteBackup } from "../server-workspace-backup.js";
import { WORKSPACE_LOGO_MAX_BYTES, WORKSPACE_BRANDING_ASSETS, workspaceLogoUrl, isWorkspaceLogoUrl, workspaceBrandMarkUrl, isWorkspaceBrandMarkUrl } from "../src/lib/workspace-logo.js";

const image = (format, width = 160, height = 60) => sharp({ create: { width, height, channels: 4, background: { r: 25, g: 120, b: 180, alpha: 0.5 } } }).toFormat(format).toBuffer();

async function withWorkspace(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "elset-logo-test-"));
  const dbPath = path.join(root, "elset-workspace.db");
  const db = openWorkspaceDb({ dbPath });
  try { return await callback({ root, dbPath, db, env: { ELSET_DATA_DIR: root, } }); }
  finally {
    db.close();
    const target = path.resolve(root);
    if (target.startsWith(path.join(os.tmpdir(), "elset-logo-test-"))) fs.rmSync(target, { recursive: true, force: true });
  }
}

test("PNG, JPEG and transparent WebP logos keep their original bytes and dimensions", async () => {
  for (const [format, mime] of [["png", "image/png"], ["jpeg", "image/jpeg"], ["webp", "image/webp"]]) {
    const bytes = await image(format);
    const asset = await validateWorkspaceLogo(bytes, mime);
    assert.equal(asset.width, 160);
    assert.equal(asset.height, 60);
    assert.equal(asset.mimeType, mime);
    assert.deepEqual(Buffer.from(asset.data, "base64"), bytes);
    assert.match(asset.id, /^[a-f0-9]{64}$/);
  }
});

test("logos reject invalid, disguised, oversized, truncated and excessive-dimension images", async () => {
  const png = await image("png");
  for (const [bytes, mime] of [
    [Buffer.from("not an image"), "image/png"], [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/png"],
    [png, "image/jpeg"], [png, "image/svg+xml"], [png.subarray(0, Math.floor(png.length / 2)), "image/png"],
    [Buffer.alloc(WORKSPACE_LOGO_MAX_BYTES + 1), "image/png"], [await image("png", 4097, 1), "image/png"],
    [await image("png", 3000, 3000), "image/png"],
  ]) await assert.rejects(validateWorkspaceLogo(bytes, mime));
});

test("shared SQLite logo survives reopen and native backup without entering app-state payloads", async () => {
  await withWorkspace(async ({ db, dbPath, env, root }) => {
    const before = loadWorkspaceStateFromDb(db);
    const bytes = await image("png");
    const asset = await validateWorkspaceLogo(bytes, "image/png");
    const result = saveWorkspaceLogo(db, asset);
    assert.equal(result.workspaceLogoUrl, workspaceLogoUrl(asset.id));
    const state = loadWorkspaceStateFromDb(db);
    assert.equal(state.settings.workspaceLogo, undefined);
    assert.equal(state.settings.workspaceLogoUrl, result.workspaceLogoUrl);
    assert.ok(!JSON.stringify(state).includes(asset.data));
    for (const key of Object.keys(before).filter(key => !["settings", "meta"].includes(key))) assert.deepEqual(state[key], before[key]);
    const reopened = openWorkspaceDb({ dbPath });
    try { assert.deepEqual(readWorkspaceLogo(reopened, asset.id).bytes, bytes); } finally { reopened.close(); }
    const backup = await createWorkspaceSqliteBackup({ env, outputRoot: path.join(root, "backups") });
    const copied = openWorkspaceDb({ dbPath: backup.workspaceBackupPath, readonly: true, migrate: false });
    try { assert.deepEqual(readWorkspaceLogo(copied, asset.id).bytes, bytes); } finally { copied.close(); }
    saveWorkspaceLogo(db, null);
    assert.equal(readWorkspaceLogo(db, asset.id), null);
    assert.equal(loadWorkspaceStateFromDb(db).settings.workspaceLogoUrl, undefined);
  });
});

test("replacement changes the asset URL and generic settings cannot bypass image validation", async () => {
  await withWorkspace(async ({ db }) => {
    const first = await validateWorkspaceLogo(await image("png"), "image/png");
    const second = await validateWorkspaceLogo(await image("webp"), "image/webp");
    assert.notEqual(saveWorkspaceLogo(db, first).workspaceLogoUrl, saveWorkspaceLogo(db, second).workspaceLogoUrl);
    assert.equal(readWorkspaceLogo(db, first.id), null);
    assert.ok(readWorkspaceLogo(db, second.id));
    for (const key of ["workspaceLogo", "workspaceLogoUrl", "workspaceBrandMark", "workspaceBrandMarkUrl"]) assert.throws(() => updateWorkspaceSettings(db, { [key]: "unvalidated" }), /Workspace Branding/);
    assert.equal(isWorkspaceLogoUrl("https://example.com/logo.png"), false);
    assert.equal(workspaceLogoUrl("../auth.db"), "");
  });
});

for (const [kind, { endpoint: assetEndpoint, key, urlKey }] of Object.entries(WORKSPACE_BRANDING_ASSETS)) test(`targeted ${kind} API enforces editor permissions, bounded uploads, authenticated reads and removal`, async () => {
  await withWorkspace(async ({ env, db }) => {
    const app = express();
    app.use(express.json({ limit: "15mb" }));
    app.use(createWorkspaceLogoRouter({ env,
      requireAuth: (req, res, next) => { if (!req.get("x-test-role")) return res.status(401).json({ error: "Authentication required." }); req.user = { role: req.get("x-test-role") }; next(); },
      requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Forbidden" }),
    }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const endpoint = base + assetEndpoint;
    const png = await image("png");
    const send = (role, body = png, type = "image/png") => fetch(endpoint, { method: "PUT", headers: { ...(role ? { "x-test-role": role } : {}), "Content-Type": type }, body });
    try {
      assert.equal((await send()).status, 401);
      assert.equal((await send("technician")).status, 403);
      for (const role of ["admin", "office"]) assert.equal((await send(role)).status, 200);
      const result = await (await send("admin")).json();
      assert.equal((await fetch(base + result[urlKey])).status, 401);
      const read = await fetch(base + result[urlKey], { headers: { "x-test-role": "technician" } });
      assert.equal(read.status, 200);
      assert.equal(read.headers.get("content-type"), "image/png");
      assert.equal(read.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual(Buffer.from(await read.arrayBuffer()), png);
      assert.equal((await send("admin", Buffer.from("fake"))).status, 400);
      assert.equal((await send("admin", Buffer.from("<svg/>"), "image/svg+xml")).status, 415);
      const large = await send("admin", Buffer.alloc(WORKSPACE_LOGO_MAX_BYTES + 1));
      assert.equal(large.status, 413);
      assert.match((await large.json()).error, /2 MB/);
      assert.equal((await fetch(endpoint, { method: "DELETE", headers: { "x-test-role": "technician" } })).status, 403);
      assert.equal((await fetch(endpoint, { method: "DELETE", headers: { "x-test-role": "office" } })).status, 200);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM settings WHERE key = ?").get(key).count, 0);
      assert.equal((await fetch(base + result[urlKey], { headers: { "x-test-role": "admin" } })).status, 404);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
});

test("brand marks share image validation and reject unsafe URLs and full-logo URLs", async () => {
  for (const [format, mime] of [["png", "image/png"], ["jpeg", "image/jpeg"], ["webp", "image/webp"]]) {
    const bytes = await image(format, 64, 64);
    const asset = await validateWorkspaceBrandingAsset(bytes, mime, "mark");
    assert.deepEqual(Buffer.from(asset.data, "base64"), bytes);
    assert.equal(isWorkspaceBrandMarkUrl(workspaceBrandMarkUrl(asset.id)), true);
    assert.equal(isWorkspaceBrandMarkUrl(workspaceLogoUrl(asset.id)), false);
  }
  for (const [bytes, mime] of [[Buffer.from("fake"), "image/png"], [Buffer.from("<svg/>"), "image/svg+xml"], [Buffer.alloc(WORKSPACE_LOGO_MAX_BYTES + 1), "image/png"], [await image("png", 4097, 1), "image/png"], [await image("png", 3000, 3000), "image/png"]]) {
    await assert.rejects(validateWorkspaceBrandingAsset(bytes, mime, "mark"));
  }
  assert.equal(isWorkspaceBrandMarkUrl("https://example.com/mark.png"), false);
  assert.equal(workspaceBrandMarkUrl("../auth.db"), "");
});

test("company logo and brand mark replace and remove independently without leaking asset bytes into state", async () => {
  await withWorkspace(async ({ db }) => {
    const logo = await validateWorkspaceLogo(await image("png"), "image/png");
    const mark = await validateWorkspaceBrandingAsset(await image("png", 64, 64), "image/png", "mark");
    const replacement = await validateWorkspaceBrandingAsset(await image("webp", 48, 48), "image/webp", "mark");
    saveWorkspaceLogo(db, logo);
    saveWorkspaceBrandingAsset(db, "mark", mark);
    assert.notEqual(workspaceLogoUrl(logo.id), workspaceBrandMarkUrl(mark.id));
    saveWorkspaceBrandingAsset(db, "mark", replacement);
    assert.equal(readWorkspaceBrandingAsset(db, "mark", mark.id), null);
    assert.ok(readWorkspaceBrandingAsset(db, "mark", replacement.id));
    assert.ok(readWorkspaceLogo(db, logo.id));
    const state = loadWorkspaceStateFromDb(db).settings;
    assert.equal(state.workspaceLogoUrl, workspaceLogoUrl(logo.id));
    assert.equal(state.workspaceBrandMarkUrl, workspaceBrandMarkUrl(replacement.id));
    assert.equal(state.workspaceBrandMark, undefined);
    assert.equal(state.workspaceLogo, undefined);
    saveWorkspaceBrandingAsset(db, "mark", null);
    assert.ok(readWorkspaceLogo(db, logo.id));
    saveWorkspaceBrandingAsset(db, "mark", mark);
    saveWorkspaceLogo(db, null);
    assert.ok(readWorkspaceBrandingAsset(db, "mark", mark.id));
    assert.equal(loadWorkspaceStateFromDb(db).settings.workspaceLogoUrl, undefined);
  });
});

for (const withMark of [true, false]) test(`${withMark ? "both branding assets" : "legacy logo-only backup"} survive verified backup materialization and reopen`, async () => {
  await withWorkspace(async ({ db, env, root }) => {
    const logo = await validateWorkspaceLogo(await image("png"), "image/png");
    const mark = await validateWorkspaceBrandingAsset(await image("webp", 64, 64), "image/webp", "mark");
    saveWorkspaceLogo(db, logo);
    if (withMark) saveWorkspaceBrandingAsset(db, "mark", mark);
    const bundle = await createWorkspaceSqliteBackupBundle({ env });
    // Materialize the actual downloadable backup, including checksum and schema validation.
    const restored = materializeWorkspaceSqliteBackup(bundle, path.join(root, "restored"));
    const copy = openWorkspaceDb({ dbPath: restored.tempDbPath, readonly: true, migrate: false });
    try {
      assert.deepEqual(readWorkspaceLogo(copy, logo.id).bytes, Buffer.from(logo.data, "base64"));
      assert.equal(loadWorkspaceStateFromDb(copy).settings.workspaceLogoUrl, workspaceLogoUrl(logo.id));
      if (withMark) {
        assert.deepEqual(readWorkspaceBrandingAsset(copy, "mark", mark.id).bytes, Buffer.from(mark.data, "base64"));
        assert.equal(loadWorkspaceStateFromDb(copy).settings.workspaceBrandMarkUrl, workspaceBrandMarkUrl(mark.id));
      } else {
        assert.equal(readWorkspaceBrandingAsset(copy, "mark", mark.id), null);
        assert.equal(loadWorkspaceStateFromDb(copy).settings.workspaceBrandMarkUrl, undefined);
      }
    } finally { copy.close(); }
  });
});
