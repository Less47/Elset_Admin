import assert from "node:assert/strict";
import test from "node:test";
import { createThemeSettingsSaveQueue, PREFERENCE_SAVE_DEBOUNCE_MS, THEME_SAVE_DEBOUNCE_MS } from "../src/hooks/theme-settings-save-queue.js";

function harness() {
  let now = 0;
  let timerId = 0;
  let activeRequests = 0;
  let maximumRequests = 0;
  const timers = new Map();
  const requests = [];
  const acknowledgements = [];
  const queue = createThemeSettingsSaveQueue({
    setTimer: (callback, delay) => {
      timers.set(++timerId, { callback, due: now + delay });
      return timerId;
    },
    clearTimer: (id) => timers.delete(id),
    save: (patch) => {
      activeRequests++;
      maximumRequests = Math.max(maximumRequests, activeRequests);
      return new Promise((resolve, reject) => requests.push({
        patch,
        resolve: () => { activeRequests--; resolve({ settings: patch }); },
        reject: (message) => { activeRequests--; reject(new Error(message)); },
      }));
    },
    onSaved: (patch) => acknowledgements.push(patch),
  });
  async function tick(ms = 0) {
    now += ms;
    for (const [id, timer] of timers) {
      if (timer.due <= now) { timers.delete(id); timer.callback(); }
    }
    await Promise.resolve();
    await Promise.resolve();
  }
  return { queue, requests, acknowledgements, tick, maximumRequests: () => maximumRequests };
}

test("theme changes are immediate and debounce for 400ms after the latest of ten selections", async () => {
  const { queue, requests, tick } = harness();
  assert.equal(THEME_SAVE_DEBOUNCE_MS, 400);
  for (let i = 0; i < 10; i++) {
    const colour = `#00000${i}`;
    queue.change({ actionColor: colour });
    assert.equal(queue.getSnapshot().overrides.actionColor, colour);
    await tick(30);
  }
  await tick(369);
  assert.equal(requests.length, 0);
  await tick(1);
  assert.deepEqual(requests.map((request) => request.patch), [{ actionColor: "#000009" }]);
  assert.equal(queue.getSnapshot().status, "saving");
  requests[0].resolve();
  await tick();
  assert.equal(queue.getSnapshot().status, "saved");
});

test("twenty preference keystrokes stay local and coalesce into one save after 600ms", async () => {
  const { queue, requests, tick } = harness();
  assert.equal(PREFERENCE_SAVE_DEBOUNCE_MS, 600);
  for (const character of "abcdefghijklmnopqrst") {
    const previous = queue.getSnapshot().overrides.bankAccountName || "";
    queue.change({ bankAccountName: `${previous}${character}` }, PREFERENCE_SAVE_DEBOUNCE_MS);
    assert.equal(queue.getSnapshot().overrides.bankAccountName, `${previous}${character}`);
    await tick(20);
  }
  await tick(579);
  assert.equal(requests.length, 0);
  await tick(1);
  assert.deepEqual(requests.map((request) => request.patch), [{ bankAccountName: "abcdefghijklmnopqrst" }]);
});

test("one request stays in flight while further changes merge, and an old acknowledgement cannot revert the UI", async () => {
  const { queue, requests, tick, maximumRequests } = harness();
  queue.change({ actionColor: "#0000FF" });
  await tick(400);
  queue.change({ actionColor: "#00FF00", sidebarHeader: "#112233" });
  queue.change({ actionColor: "#FF8800" });
  await tick(4000);
  assert.equal(requests.length, 1);
  requests[0].resolve();
  await tick();
  assert.equal(queue.getSnapshot().overrides.actionColor, "#FF8800");
  assert.deepEqual(requests[1].patch, { actionColor: "#FF8800", sidebarHeader: "#112233" });
  requests[1].resolve();
  await tick();
  assert.equal(maximumRequests(), 1);
  assert.equal(queue.getSnapshot().status, "saved");
});

test("finishing an earlier request does not shorten the latest change's debounce", async () => {
  const { queue, requests, tick } = harness();
  queue.change({ actionColor: "#111111" });
  await tick(400);
  queue.change({ actionColor: "#222222" });
  await tick(100);
  requests[0].resolve();
  await tick(299);
  assert.equal(requests.length, 1);
  await tick(1);
  assert.equal(requests.length, 2);
});

test("returning to the in-flight value avoids a duplicate write", async () => {
  const { queue, requests, tick } = harness();
  queue.change({ actionColor: "#111111" });
  await tick(400);
  queue.change({ actionColor: "#222222" });
  queue.change({ actionColor: "#111111" });
  await tick(400);
  requests[0].resolve();
  await tick();
  assert.equal(requests.length, 1);
  assert.equal(queue.getSnapshot().status, "saved");
});

for (const message of ["Theme change could not be saved.", "409: Workspace settings conflict."]) {
  test(`failure retains the latest visual choice and retries once without bypassing: ${message}`, async () => {
    const { queue, requests, tick, acknowledgements } = harness();
    queue.change({ actionColor: "#111111", sidebarHeader: "#333333" });
    await tick(400);
    queue.change({ actionColor: "#222222" });
    await tick(400);
    requests[0].reject(message);
    await tick(5000);
    assert.equal(requests.length, 1);
    assert.deepEqual(acknowledgements, []);
    assert.equal(queue.getSnapshot().status, "error");
    assert.equal(queue.getSnapshot().error, message);
    assert.equal(queue.getSnapshot().overrides.actionColor, "#222222");
    queue.retry();
    queue.retry();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].patch, { actionColor: "#222222", sidebarHeader: "#333333" });
    requests[1].resolve();
    await tick();
    assert.equal(queue.getSnapshot().status, "saved");
    assert.equal(queue.getSnapshot().error, "");
  });
}

test("changing colours after an error resumes saving the entire unsaved patch", async () => {
  const { queue, requests, tick } = harness();
  queue.change({ actionColor: "#111111" });
  await tick(400);
  requests[0].reject("Offline");
  await tick();
  queue.change({ sidebarHeader: "#222222" });
  await tick(400);
  assert.deepEqual(requests[1].patch, { actionColor: "#111111", sidebarHeader: "#222222" });
});

test("Settings subscriptions can unmount without losing pending changes", async () => {
  const { queue, requests, tick } = harness();
  let notices = 0;
  const unsubscribe = queue.subscribe(() => notices++);
  queue.change({ actionColor: "#111111" });
  unsubscribe();
  await tick(400);
  requests[0].resolve();
  await tick();
  assert.equal(notices, 1);
  assert.equal(queue.getSnapshot().status, "saved");
});

test("ending the session cancels pending work and ignores old responses", async () => {
  const { queue, requests, tick, acknowledgements } = harness();
  // React StrictMode replays the initial subscription lifecycle.
  queue.dispose();
  queue.activate();
  queue.change({ actionColor: "#111111" });
  await tick(400);
  queue.change({ actionColor: "#222222" });
  queue.dispose();
  requests[0].resolve();
  await tick(4000);
  assert.equal(requests.length, 1);
  assert.deepEqual(acknowledgements, []);
  assert.equal(queue.change({ actionColor: "#333333" }), false);
});
