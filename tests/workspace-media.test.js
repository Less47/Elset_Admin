import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import sharp from "sharp";
import { openWorkspaceDb, migrateWorkspaceSchema, WORKSPACE_SCHEMA_VERSION } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { loadWorkspaceStateFromDb } from "../server-workspace-state.js";
import { createWorkspaceMediaRouter } from "../server-workspace-media-routes.js";
import { createCustomerRouter } from "../server-customer-routes.js";
import { getAuthorizedWorkspaceState } from "../server-workspace-storage.js";
import { authorizeMediaOwner, listSitePhotos, processMediaImage, readStaffAvatar, saveOwnerPhoto } from "../server-workspace-media.js";
import { addJobPhoto, createJob, updateJobDetails } from "../server-workspace-jobs.js";
import { deleteCustomer, restoreCustomer, deleteCustomerSite, emptyDeletedCustomers, updateCustomerSite } from "../server-workspace-customers.js";
import { deleteStaffMember, restoreDeletedStaffMember } from "../server-workspace-staff.js";
import { createWorkspaceSqliteBackupBundle } from "../server-workspace-backup.js";
import { restoreWorkspaceSqliteBackupPayload } from "../server-workspace-restore.js";
import { STAFF_PHOTO_MAX_BYTES, SITE_PHOTO_MAX_BYTES, staffInitials } from "../src/lib/workspace-media.js";

const admin = { id: "media-test", name: "Photo Tester", role: "admin" };
const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/demo-workspace.json", import.meta.url), "utf8"));
const image = format => sharp({ create: { width: 640, height: 480, channels: 3, background: "#487b94" } })[format]().toBuffer();

async function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elset-media-test-"));
  const env = { ELSET_DATA_DIR: directory };
  const dbPath = path.join(directory, "elset-workspace.db");
  const db = openWorkspaceDb({ dbPath });
  const state = structuredClone(fixture);
  state.staff.push({ ...state.staff[0], id: "second-staff", name: "Other Technician" });
  state.customers.push({ ...state.customers[0], id: "second-customer", name: "Other Customer", sites: [], contacts: [], contactAssignments: [], siteAccessNotes: [] });
  const customer = state.customers.find(c => c.id === state.jobs[0].customerId);
  const site = customer.sites[0];
  const otherSite = { ...site, id: "other-site", address: "Other address", assets: [] };
  customer.sites.push(otherSite);
  const base = { ...state.jobs[0], quote: null, invoice: null, maintenancePlanId: "", notes: [], photos: [], jobAddress: site.address };
  state.jobs = [{ ...base, id: "linked", siteId: site.id }, { ...base, id: "other", siteId: otherSite.id, jobNumber: 2002 }, { ...base, id: "unlinked", siteId: "", jobNumber: 2003 }];
  importWorkspaceJsonData(db, state);
  const png = await image("png");
  for (const job of state.jobs) addJobPhoto(db, job.id, { id: `${job.id}-photo`, name: `${job.id}.png`, url: `data:image/png;base64,${png.toString("base64")}` });
  const requireAuth = (req, res, next) => {
    const role = req.get("X-Test-Role");
    if (!role) return res.status(401).json({ error: "Authentication required." });
    req.user = { ...admin, role, staffId: req.get("X-Test-Staff") || state.staff[0].id }; next();
  };
  const requireRole = roles => (req, res, next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ error: "Permission denied." });
  const app = express(); app.use(createWorkspaceMediaRouter({ requireAuth, requireRole, env }));
  app.use(express.json()); app.use(createCustomerRouter({ requireAuth, requireRole, env }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); if (db.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const request = async (url, options = {}, role = "admin") => {
    const response = await fetch(baseUrl + url, { ...options, headers: { ...(role ? { "X-Test-Role": role } : {}), ...options.headers } });
    return { response, payload: response.headers.get("Content-Type")?.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  const upload = (type, bytes = png, mime = "image/png", name = "photo.png", role = "admin", id = type === "staff" ? state.staff[0].id : site.id) => request(type === "staff" ? `/api/staff/${id}/avatar` : `/api/sites/${id}/photos`, {
    method: "PUT", headers: { "Content-Type": mime, "X-Media-Filename": encodeURIComponent(name) }, body: bytes,
  }, role);
  return { directory, env, dbPath, db, state, site, otherSite, png, request, upload };
}

for (const type of ["staff", "site"]) for (const [format, mime, extension] of [["jpeg", "image/jpeg", "jpg"], ["png", "image/png", "png"], ["webp", "image/webp", "webp"]]) {
  test(`${type} accepts, decodes, optimizes and persists ${format}`, async t => {
    const f = await setup(t), bytes = await image(format);
    const result = await f.upload(type, bytes, mime, `photo.${extension}`);
    assert.equal(result.response.status, 200, result.payload.error);
    assert.equal(result.payload.state, undefined); assert.equal(result.payload.delta, undefined);
    const row = f.db.prepare("SELECT * FROM workspace_media WHERE id=?").get(result.payload.photo.id);
    assert.equal(row.owner_id, type === "site" ? f.site.id : f.state.staff[0].id);
    assert.equal(row.mime_type, "image/webp");
    assert.equal((await sharp(row.thumbnail).metadata()).width, type === "staff" ? 96 : 320);
    assert.equal(result.payload.photo.uploadedBy, "Photo Tester");
    const served = await f.request(result.payload.photo.url);
    assert.equal(served.response.status, 200); assert.deepEqual(served.payload, row.image);
    assert.equal(served.response.headers.get("X-Content-Type-Options"), "nosniff");
  });
}
for (const type of ["staff", "site"]) {
  test(`${type} rejects unsupported and spoofed types, corrupt files and executable extensions`, async t => {
    const f = await setup(t);
    for (const [bytes, mime, name] of [[Buffer.from("<svg/>"), "image/svg+xml", "x.svg"], [f.png, "image/jpeg", "x.jpg"], [f.png.subarray(0, 24), "image/png", "x.png"], [f.png, "image/png", "x.exe"], [f.png, "image/png", "x.jpg"]]) {
      const result = await f.upload(type, bytes, mime, name);
      assert.ok([400, 415].includes(result.response.status), result.payload.error);
    }
    assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_media").get().n, 0);
  });
  test(`${type} rejects oversized uploads`, async t => {
    const f = await setup(t);
    const result = await f.upload(type, Buffer.alloc((type === "staff" ? STAFF_PHOTO_MAX_BYTES : SITE_PHOTO_MAX_BYTES) + 1));
    assert.equal(result.response.status, 413);
    assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_media").get().n, 0);
  });
}
test("image decoder rejects excessive dimensions and animated images", async () => {
  const tooWide = await sharp({ create: { width: 12001, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(processMediaImage(tooWide, "image/png", "site", "wide.png"), /static image/);
  const animated = await sharp(Buffer.concat([Buffer.alloc(2 * 2 * 3, 40), Buffer.alloc(2 * 2 * 3, 220)]), { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  await assert.rejects(processMediaImage(animated, "image/webp", "staff", "animated.webp"), /static image/);
});
test("avatar change is atomic, removes prior BLOBs, and remove restores initials fallback", async t => {
  const f = await setup(t), staffId = f.state.staff[0].id;
  const first = (await f.upload("staff")).payload.photo;
  const second = (await f.upload("staff")).payload.photo;
  assert.notEqual(first.id, second.id);
  assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_media WHERE owner_type='staff'").get().n, 1);
  assert.equal((await f.request(first.url)).response.status, 404);
  assert.equal(readStaffAvatar(f.db, staffId).id, second.id);
  const state = loadWorkspaceStateFromDb(f.db);
  assert.equal(state.staff[0].avatarUrl, second.thumbnailUrl);
  assert.equal(JSON.stringify(state.staff).includes("base64"), false);
  const result = await f.request(`/api/staff/${staffId}/avatar`, { method: "DELETE" });
  assert.equal(result.response.status, 200); assert.equal(readStaffAvatar(f.db, staffId), null);
  assert.equal(loadWorkspaceStateFromDb(f.db).staff[0].avatarUrl, "");
  assert.equal(staffInitials("Casey Example"), "CE"); assert.equal(staffInitials(""), "?");
});
test("failed avatar replacement preserves the previous image", async t => {
  const f = await setup(t), first = (await f.upload("staff")).payload.photo;
  f.db.exec("CREATE TRIGGER fail_media_insert BEFORE INSERT ON workspace_media BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  assert.equal((await f.upload("staff")).response.status, 500);
  assert.equal(readStaffAvatar(f.db, f.state.staff[0].id).id, first.id);
  assert.equal((await f.request(first.url)).response.status, 200);
});
test("assigned technician avatar survives scoped job reads and technician state projection", async t => {
  const f = await setup(t), staffId = f.state.staff[1].id;
  const photo = (await f.upload("staff", f.png, "image/png", "x.png", "admin", staffId)).payload.photo;
  updateJobDetails(f.db, "linked", { assignedTechnicianId: staffId, assignedTechnicianName: "Other Technician" });
  const user = { role: "technician", staffId: f.state.staff[0].id };
  const state = getAuthorizedWorkspaceState(user, { env: f.env });
  assert.equal(state.staff.some(member => member.id === staffId), false);
  const job = state.jobs.find(job => job.id === "linked");
  assert.equal(job.assignedTechnicianId, staffId); assert.equal(job.assignedTechnicianAvatarUrl, photo.thumbnailUrl);
  assert.equal(updateJobDetails(f.db, "linked", { title: "Scoped read" }).assignedTechnicianAvatarUrl, photo.thumbnailUrl);
});
test("permanent Site deletion acknowledges Job unlinking through a scoped delta", async t => {
  const f = await setup(t), photo = (await f.upload("site")).payload.photo;
  const result = await f.request(`/api/customers/${f.state.jobs[0].customerId}/sites/${f.site.id}`, { method: "DELETE" });
  assert.equal(result.response.status, 200, result.payload.error); assert.equal(result.payload.state, undefined);
  const job = result.payload.delta.jobs.upsert.find(job => job.id === "linked");
  assert.equal(job.siteId, ""); assert.equal(result.payload.delta.jobs.upsert.length, 1);
  assert.equal((await f.request(photo.url)).response.status, 404);
});
for (const type of ["staff", "site"]) test(`${type} mutations allow Admin/Office and reject Technician/anonymous/unknown roles`, async t => {
  const f = await setup(t);
  assert.equal((await f.upload(type, f.png, "image/png", "x.png", "office")).response.status, 200);
  for (const role of ["technician", "unknown", ""]) assert.equal((await f.upload(type, f.png, "image/png", "x.png", role)).response.status, role ? 403 : 401);
  assert.equal((await f.upload(type, f.png, "image/png", "x.png", "admin", "missing-owner")).response.status, 404);
});
test("image serving authenticates and denies unrelated Site/Staff media to technicians", async t => {
  const f = await setup(t), sitePhoto = (await f.upload("site")).payload.photo;
  assert.equal((await f.request(sitePhoto.url, {}, "")).response.status, 401);
  assert.equal((await f.request(sitePhoto.url, {}, "technician")).response.status, 200);
  f.db.prepare("UPDATE jobs SET site_id=NULL").run();
  assert.equal((await f.request(sitePhoto.thumbnailUrl, {}, "technician")).response.status, 404);
  assert.equal((await f.request(`/api/sites/${f.site.id}/photos`, {}, "technician")).response.status, 404);
  const staffPhoto = (await f.upload("staff", f.png, "image/png", "x.png", "admin", f.state.staff[1].id)).payload.photo;
  f.db.prepare("UPDATE jobs SET assigned_technician_id=NULL").run();
  assert.equal((await f.request(staffPhoto.url, {}, "technician")).response.status, 404);
  f.db.prepare("UPDATE jobs SET assigned_technician_id=? WHERE id='linked'").run(f.state.staff[1].id);
  assert.equal((await f.request(staffPhoto.url, {}, "technician")).response.status, 200);
});
test("multiple Site photos survive normal database reload and rename", async t => {
  const f = await setup(t);
  await f.upload("site"); await f.upload("site");
  updateCustomerSite(f.db, f.site.customerId || f.state.jobs[0].customerId, f.site.id, { ...f.site, address: "Renamed Site address" });
  const reopened = openWorkspaceDb({ dbPath: f.dbPath, readonly: true, migrate: false });
  try { assert.equal(listSitePhotos(reopened, admin, f.site.id, { source: "site" }).photos.length, 2); } finally { reopened.close(); }
});
test("Site photo captions are bounded and ownership/permissions enforced", async t => {
  const f = await setup(t), photo = (await f.upload("site")).payload.photo;
  const endpoint = `/api/sites/${f.site.id}/photos/${photo.id}`;
  const patch = (caption, url = endpoint, role = "admin") => f.request(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caption }) }, role);
  assert.equal((await patch("Main gate")).response.status, 200);
  assert.equal(listSitePhotos(f.db, admin, f.site.id, { source: "site" }).photos[0].caption, "Main gate");
  assert.equal((await patch("x".repeat(241))).response.status, 400);
  assert.equal((await patch("wrong", `/api/sites/${f.otherSite.id}/photos/${photo.id}`)).response.status, 404);
  assert.equal((await patch("wrong", endpoint, "technician")).response.status, 403);
});
test("gallery includes only explicitly linked Job photos without copying data or matching addresses", async t => {
  const f = await setup(t);
  const photos = listSitePhotos(f.db, admin, f.site.id).photos;
  assert.deepEqual(photos.map(photo => photo.id), ["linked-photo"]);
  assert.equal(photos[0].jobId, "linked"); assert.equal(photos[0].jobNumber, f.state.jobs[0].jobNumber);
  assert.equal(photos[0].jobTitle, f.state.jobs[0].title); assert.ok(photos[0].jobDate);
  assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_media").get().n, 0);
  assert.equal(JSON.stringify(photos).includes("base64"), false);
  const thumb = await f.request(photos[0].thumbnailUrl);
  assert.equal(thumb.response.status, 200); assert.equal((await sharp(thumb.payload).metadata()).width, 320);
  const full = await f.request(photos[0].url); assert.deepEqual(full.payload, f.png);
  assert.equal((await f.request(`/api/sites/${f.site.id}/photos/jobs/other-photo/image`)).response.status, 404);
  assert.equal((await f.request(`/api/sites/${f.site.id}/photos/jobs/unlinked-photo/thumbnail`)).response.status, 404);
});
test("deleting a Site photo never deletes Job media and cannot target another Site", async t => {
  const f = await setup(t), photo = (await f.upload("site")).payload.photo;
  assert.equal((await f.request(`/api/sites/${f.otherSite.id}/photos/${photo.id}`, { method: "DELETE" })).response.status, 404);
  assert.equal((await f.request(`/api/sites/${f.site.id}/photos/linked-photo`, { method: "DELETE" })).response.status, 404);
  assert.equal((await f.request(`/api/sites/${f.site.id}/photos/${photo.id}`, { method: "DELETE" }, "technician")).response.status, 403);
  assert.equal((await f.request(`/api/sites/${f.site.id}/photos/${photo.id}`, { method: "DELETE" })).response.status, 200);
  assert.equal((await f.request(photo.url)).response.status, 404);
  assert.equal(f.db.prepare("SELECT count(*) n FROM job_attachments").get().n, 3);
});
test("gallery paginates metadata and filters source, including equal timestamps", async t => {
  const f = await setup(t), processed = await processMediaImage(f.png, "image/png", "site", "x.png");
  for (let i = 0; i < 35; i++) saveOwnerPhoto(f.db, admin, "site", f.site.id, processed, `photo-${i}.png`);
  f.db.prepare("UPDATE workspace_media SET created_at='2026-10-05'").run();
  const first = listSitePhotos(f.db, admin, f.site.id), second = listSitePhotos(f.db, admin, f.site.id, { offset: first.nextOffset });
  assert.equal(first.photos.length, 30); assert.equal(second.photos.length, 6); assert.equal(second.nextOffset, null);
  assert.equal(new Set([...first.photos, ...second.photos].map(photo => photo.id)).size, 36);
  assert.equal(listSitePhotos(f.db, admin, f.site.id, { source: "job" }).photos.length, 1);
  assert.throws(() => listSitePhotos(f.db, admin, f.site.id, { limit: 100 }), /page/);
  assert.throws(() => listSitePhotos(f.db, admin, f.site.id, { source: "unknown" }), /filter/);
});
test("missing and unsafe legacy Job URLs and arbitrary paths are never fetched/served", async t => {
  const f = await setup(t);
  for (const url of ["https://example.test/private.png", "file:///etc/passwd", "data:image/svg+xml;base64,PHN2Zy8+", ""]) {
    f.db.prepare("UPDATE job_attachments SET url=?,path='../../secret' WHERE id='linked-photo'").run(url);
    assert.equal((await f.request(`/api/sites/${f.site.id}/photos/jobs/linked-photo/image`)).response.status, 404);
  }
  assert.equal((await f.request("/api/media/missing/thumbnail")).response.status, 404);
});
test("explicit Job Site ownership validates create/update and free-text edits clear the link", async t => {
  const f = await setup(t), customerId = f.state.jobs[0].customerId;
  const job = createJob(f.db, { customer: { id: customerId }, job: { title: "Linked create", jobAddress: f.site.address, siteId: f.site.id } });
  assert.equal(job.siteId, f.site.id);
  const legacy = createJob(f.db, { customer: { id: customerId }, job: { title: "Address only", jobAddress: f.site.address } });
  assert.equal(legacy.siteId, "");
  assert.throws(() => updateJobDetails(f.db, job.id, { siteId: "foreign-site" }), /belong/);
  assert.throws(() => createJob(f.db, { customer: { id: customerId }, job: { jobAddress: f.site.address, siteId: "foreign-site" } }), /belong/);
  assert.equal(updateJobDetails(f.db, job.id, { jobAddress: "Changed free text" }).siteId, "");
  assert.equal(updateJobDetails(f.db, legacy.id, { siteId: f.site.id }).siteId, f.site.id);
  const otherCustomer = f.state.customers.find(c => c.id !== customerId);
  assert.throws(() => f.db.prepare("UPDATE jobs SET customer_id=? WHERE id=?").run(otherCustomer.id, legacy.id), /does not belong/);
});
test("inline new Site is explicitly linked without an address-based backfill", async t => {
  const f = await setup(t);
  const job = createJob(f.db, { customer: { id: f.state.jobs[0].customerId }, job: { jobAddress: "New saved address" }, siteInput: { id: "inline-site", address: "New saved address" } });
  assert.equal(job.siteId, "inline-site");
  assert.equal(f.db.prepare("SELECT site_id FROM jobs WHERE id='unlinked'").get().site_id, null);
});
test("Staff archive retains image for restore and prevents serving while archived", async t => {
  const f = await setup(t), photo = (await f.upload("staff")).payload.photo, id = f.state.staff[0].id;
  deleteStaffMember(f.db, id); assert.equal((await f.request(photo.url)).response.status, 404);
  assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_media").get().n, 1);
  const restored = restoreDeletedStaffMember(f.db, id); assert.equal(restored.avatarUrl, photo.thumbnailUrl);
  assert.equal((await f.request(photo.url)).response.status, 200);
});
test("customer archive/restore retains Site media; permanent Site removal cleans BLOBs and unlinks Jobs", async t => {
  const f = await setup(t), photo = (await f.upload("site")).payload.photo, customerId = f.state.jobs[0].customerId;
  deleteCustomer(f.db, customerId); assert.equal((await f.request(photo.url)).response.status, 404);
  restoreCustomer(f.db, customerId); assert.equal((await f.request(photo.url)).response.status, 200);
  // Customer archive removes live Jobs; use another explicit link for deletion semantics.
  const job = createJob(f.db, { customer: { id: customerId }, job: { jobAddress: f.site.address, siteId: f.site.id } });
  deleteCustomerSite(f.db, customerId, f.site.id);
  assert.equal(f.db.prepare("SELECT site_id FROM jobs WHERE id=?").get(job.id).site_id, null);
  assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_media").get().n, 0);
});
test("empty customer recycle bin cleans archived Site media", async t => {
  const f = await setup(t); await f.upload("site"); deleteCustomer(f.db, f.state.jobs[0].customerId); emptyDeletedCustomers(f.db);
  assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_media").get().n, 0);
});
test("SQLite backup/restore includes media metadata, originals, thumbnails and explicit links", async t => {
  const f = await setup(t); await f.upload("staff"); await f.upload("site");
  const before = f.db.prepare("SELECT * FROM workspace_media ORDER BY id").all();
  const bundle = await createWorkspaceSqliteBackupBundle({ env: f.env });
  assert.equal(bundle.metadata.workspace.schemaVersion, 17); assert.equal(bundle.metadata.workspace.summary.counts.workspaceMedia, 2);
  f.db.prepare("DELETE FROM workspace_media").run();
  f.db.close();
  await restoreWorkspaceSqliteBackupPayload(bundle, { env: f.env });
  const restored = openWorkspaceDb({ dbPath: f.dbPath, readonly: true, migrate: false });
  try { assert.deepEqual(restored.prepare("SELECT * FROM workspace_media ORDER BY id").all(), before); assert.equal(restored.prepare("SELECT site_id FROM jobs WHERE id='linked'").get().site_id, f.site.id); }
  finally { restored.close(); }
});
test("schema 16 -> 17 is transactional, additive, idempotent and never infers old Job sites", async t => {
  const f = await setup(t);
  f.db.exec("DROP TRIGGER jobs_site_owner_insert; DROP TRIGGER jobs_site_owner_update; DROP INDEX idx_jobs_explicit_site; ALTER TABLE jobs DROP COLUMN site_id; DROP TABLE workspace_media; DELETE FROM workspace_schema_migrations WHERE version=17; UPDATE workspace_info SET schema_version=16; PRAGMA user_version=16;");
  const photos = f.db.prepare("SELECT * FROM job_attachments").all();
  f.db.exec("CREATE TRIGGER fail_v17 BEFORE INSERT ON workspace_schema_migrations WHEN NEW.version=17 BEGIN SELECT RAISE(ABORT,'media migration failed'); END");
  assert.throws(() => migrateWorkspaceSchema(f.db), /media migration failed/);
  assert.equal(f.db.pragma("user_version", { simple: true }), 16);
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='workspace_media'").get().n, 0);
  f.db.exec("DROP TRIGGER fail_v17"); migrateWorkspaceSchema(f.db); migrateWorkspaceSchema(f.db);
  assert.equal(WORKSPACE_SCHEMA_VERSION, 17); assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_schema_migrations WHERE version=17").get().n, 1);
  assert.deepEqual(f.db.prepare("SELECT * FROM job_attachments").all(), photos);
  assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE site_id IS NOT NULL").get().n, 0);
  assert.deepEqual(f.db.pragma("foreign_key_check"), []);
  assert.throws(() => authorizeMediaOwner(f.db, { role: "technician", staffId: "unrelated" }, "site", f.site.id), /not found/);
});
