import assert from "node:assert/strict";
import test from "node:test";
import { createUserUiPreferencesStore } from "../src/hooks/user-ui-preferences-store.js";
import { normalizeUserUiPreferences } from "../src/lib/user-ui-preferences.js";

const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const response = (preferences) => ({ ok: true, json: async () => ({ preferences }) });
const visible = (store) => normalizeUserUiPreferences(store.getSnapshot().stored, store.getSnapshot().overrides);

test("personal preferences coalesce twenty selections and keep latest UI through a stale in-flight response", async () => {
  const writes = [];
  let active = 0;
  let maxActive = 0;
  const store = createUserUiPreferencesStore({ sessionKey: "A", fetchWithAuth: async (url, options) => {
    assert.equal(url, "/api/user-preferences");
    if (options.method !== "PATCH") return response({ actionColor: "#123456" });
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise((resolve) => writes.push({ patch: JSON.parse(options.body), resolve: () => { active--; resolve(response({ actionColor: "#000000" })); } }));
  } });
  store.activate();
  try {
    await pause();
    for (let i = 0; i < 20; i++) store.change({ actionColor: `#AA00${i.toString(16).padStart(2, "0")}` });
    assert.equal(visible(store).actionColor, "#AA0013");
    assert.equal(writes.length, 0);
    await pause(450);
    assert.deepEqual(writes[0].patch, { actionColor: "#AA0013" });
    store.change({ actionColor: "#112233", siteView: "grid" });
    await pause(450);
    assert.equal(writes.length, 1);
    writes[0].resolve();
    await pause();
    assert.equal(visible(store).actionColor, "#112233");
    assert.deepEqual(writes[1].patch, { actionColor: "#112233", siteView: "grid" });
    writes[1].resolve();
    await pause();
    assert.equal(store.getSnapshot().status, "saved");
    assert.equal(visible(store).siteView, "grid");
    assert.equal(maxActive, 1);
  } finally { store.dispose(); }
});

test("identity teardown aborts loads and cancels pending writes before another account starts", async () => {
  let resolveA;
  let signalA;
  const writes = [];
  const a = createUserUiPreferencesStore({ sessionKey: "A", fetchWithAuth: async (_url, options) => {
    signalA = options.signal;
    if (options.method === "PATCH") writes.push(JSON.parse(options.body));
    return new Promise((resolve) => { resolveA = resolve; });
  } });
  a.activate();
  a.change({ actionColor: "#ff8800" });
  a.dispose();
  const b = createUserUiPreferencesStore({ sessionKey: "B", fetchWithAuth: async () => response({ actionColor: "#0077ff" }) });
  b.activate();
  try {
    resolveA(response({ actionColor: "#ff8800" }));
    await pause(450);
    assert.equal(signalA.aborted, true);
    assert.equal(a.getSnapshot().stored, null);
    assert.equal(visible(b).actionColor, "#0077FF");
    assert.equal(writes.length, 0);
  } finally { b.dispose(); }
});

test("load and save errors retain usable local preferences and allow explicit retry", async () => {
  let failLoad = true;
  let failSave = true;
  const store = createUserUiPreferencesStore({ sessionKey: "A", fetchWithAuth: async (_url, options) => {
    const saving = options.method === "PATCH";
    if (saving ? failSave : failLoad) return { ok: false, json: async () => ({ error: "Temporarily unavailable" }) };
    return response(saving ? JSON.parse(options.body) : { actionColor: "#123456" });
  } });
  store.activate();
  try {
    await pause();
    assert.equal(store.getSnapshot().loaded, true);
    assert.equal(store.getSnapshot().loadError, "Temporarily unavailable");
    failLoad = false;
    store.retry();
    await pause();
    assert.equal(visible(store).actionColor, "#123456");
    store.change({ actionColor: "#ff8800" });
    await pause(450);
    assert.equal(store.getSnapshot().status, "error");
    assert.equal(visible(store).actionColor, "#FF8800");
    failSave = false;
    store.retry();
    await pause();
    assert.equal(store.getSnapshot().status, "saved");
    assert.equal(visible(store).actionColor, "#FF8800");
  } finally { store.dispose(); }
});
