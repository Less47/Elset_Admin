import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsDraft, createSettingsDraftGroup, settingsFingerprint, settingsPatch } from "../src/lib/settings-draft.js";
test("section Save captures every resource at click time and leaves later edits unsaved", async () => {
  const group = createSettingsDraftGroup(), first = createSettingsDraft({ value: "A" }), second = createSettingsDraft({ value: "B" }), clean = createSettingsDraft({ value: "C" });
  let release; const written = [];
  group.register("first", first, value => new Promise(resolve => { release = () => resolve(value); }));
  group.register("second", second, async value => { written.push(value); return value; });
  group.register("clean", clean, () => assert.fail("a field edited after Save was silently persisted"));
  first.change({ value: "A1" }); second.change({ value: "B1" });
  const saving = group.save();
  second.change({ value: "B2" }); clean.change({ value: "C2" });
  release(); await saving;
  assert.deepEqual(written, [{ value: "B1" }]);
  assert.equal(second.getSnapshot().baseline.value, "B1");
  assert.equal(second.getSnapshot().draft.value, "B2");
  assert.equal(second.getSnapshot().dirty, true);
  assert.equal(clean.getSnapshot().baseline.value, "C");
  assert.equal(group.getSnapshot().dirty, true);
  assert.equal(group.getSnapshot().saved, false);
});

test("settings drafts start clean, ignore key order, become dirty and revert without writes", () => {
  const store = createSettingsDraft({ name: "ELSET", tax: { rate: 10, code: "GST" } });
  assert.equal(store.getSnapshot().dirty, false);
  store.change({ tax: { code: "GST", rate: 10 }, name: "ELSET" });
  assert.equal(store.getSnapshot().dirty, false);
  store.change(value => ({ ...value, name: "New name" }));
  assert.equal(store.getSnapshot().dirty, true);
  store.change(value => ({ ...value, name: "ELSET" }));
  assert.equal(store.getSnapshot().dirty, false);
  assert.equal(settingsFingerprint({ a: [1, 2] }), settingsFingerprint({ a: [1, 2] }));
  assert.notEqual(settingsFingerprint({ a: [1, 2] }), settingsFingerprint({ a: [2, 1] }));
});

test("one explicit save submits all changed fields and acknowledges the persisted baseline", async () => {
  const store = createSettingsDraft({ name: "ELSET", email: "old@example.test", phone: "123" }), writes = [];
  const persist = async (value, baseline) => { writes.push(settingsPatch(baseline, value)); return { ...value, name: value.name.trim() }; };
  await store.save(persist);
  assert.equal(writes.length, 0);
  store.change(value => ({ ...value, name: " Changed ", email: "new@example.test" }));
  assert.equal(writes.length, 0);
  assert.equal(await store.save(persist), true);
  assert.deepEqual(writes, [{ name: " Changed ", email: "new@example.test" }]);
  assert.equal(store.getSnapshot().draft.name, "Changed");
  assert.equal(store.getSnapshot().dirty, false);
  assert.equal(store.getSnapshot().status, "saved");
  await store.save(persist);
  assert.equal(writes.length, 1);
});

test("failed saves preserve draft and baseline; retry explicitly writes and clears the error", async () => {
  const store = createSettingsDraft({ company: "ELSET" });
  store.change({ company: "New" });
  assert.equal(await store.save(async () => { throw new Error("Unavailable"); }), false);
  assert.equal(store.getSnapshot().dirty, true);
  assert.equal(store.getSnapshot().draft.company, "New");
  assert.equal(store.getSnapshot().baseline.company, "ELSET");
  assert.equal(store.getSnapshot().error, "Unavailable");
  assert.equal(await store.save(async value => value), true);
  assert.equal(store.getSnapshot().error, "");
  assert.equal(store.getSnapshot().dirty, false);
});

test("in-flight saves do not lose subsequent edits or permit overlapping writes/discard", async () => {
  const store = createSettingsDraft({ color: "blue" });
  store.change({ color: "green" });
  let acknowledge;
  const pending = store.save(() => new Promise(resolve => { acknowledge = resolve; }));
  assert.equal(store.getSnapshot().saving, true);
  assert.equal(store.discard(), false);
  assert.equal(await store.save(() => assert.fail("duplicate save")), false);
  store.change({ color: "red" });
  store.sync({ color: "stale" });
  acknowledge({ color: "green" });
  await pending;
  assert.equal(store.getSnapshot().draft.color, "red");
  assert.equal(store.getSnapshot().baseline.color, "green");
  assert.equal(store.getSnapshot().dirty, true);
  await store.save(async value => value);
  assert.equal(store.getSnapshot().dirty, false);
});

test("runtime reloads cannot erase dirty fields; clean drafts accept fresh persisted values", () => {
  const store = createSettingsDraft({ account: "A" });
  store.sync({ account: "B" });
  assert.equal(store.getSnapshot().draft.account, "B");
  store.change({ account: "C" });
  store.sync({ account: "D" });
  assert.equal(store.getSnapshot().draft.account, "C");
  store.discard();
  assert.equal(store.getSnapshot().draft.account, "B");
  assert.equal(store.getSnapshot().dirty, false);
});

test("section save preserves independently acknowledged resources across a later failure", async () => {
  const group = createSettingsDraftGroup(), business = createSettingsDraft({ name: "A" }), logo = createSettingsDraft({ url: "old" });
  let businessWrites = 0, failLogo = true;
  const stopBusiness = group.register("business", business, async value => { businessWrites++; return value; });
  const stopLogo = group.register("logo", logo, async value => { if (failLogo) throw new Error("Logo rejected"); return value; });
  business.change({ name: "B" }); logo.change({ url: "preview" });
  assert.equal(group.getSnapshot().dirty, true);
  assert.equal(await group.save(), false);
  assert.equal(business.getSnapshot().dirty, false);
  assert.equal(logo.getSnapshot().dirty, true);
  assert.deepEqual(group.getSnapshot().errors, ["Logo rejected"]);
  failLogo = false;
  assert.equal(await group.save(), true);
  assert.equal(businessWrites, 1);
  assert.equal(group.getSnapshot().dirty, false);
  assert.equal(group.getSnapshot().saved, true);
  logo.change({ url: "discard me" });
  group.discard();
  assert.equal(logo.getSnapshot().draft.url, "preview");
  assert.equal(group.getSnapshot().dirty, false);
  stopBusiness(); stopLogo();
  assert.equal(group.getSnapshot().dirty, false);
});
