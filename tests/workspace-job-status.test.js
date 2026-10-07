import assert from "node:assert/strict";
import test from "node:test";
import { createJobStatusQueue, mergeJobStatusFields, mergeMaintenanceJobCompletion, requestJobStatusUpdate } from "../src/hooks/workspace-job-status.js";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  let state = { jobs: [
    { id: "a", status: "To Do", updatedAt: "old", scheduledDate: "2026-09-17", serviceBoardNote: "Parts", quote: { items: [1] } },
    { id: "b", status: "To Do", updatedAt: "other" },
  ], customers: [{ id: "customer" }] };
  const queue = createJobStatusQueue(), requests = [], errors = [];
  return {
    get state() { return state; }, edit: (fn) => { state = fn(state); }, requests, errors,
    move(id, nextStatus) {
      return queue({ job: state.jobs.find((job) => job.id === id), nextStatus,
        save(status, expectedStatus) { const gate = deferred(); requests.push({ id, status, expectedStatus, ...gate }); return gate.promise; },
        merge: (fields, expected) => { state = mergeJobStatusFields(state, id, fields, expected); },
        onError: (error) => errors.push(error.message),
      });
    },
  };
}
const saved = (status, extra = {}) => ({ job: { id: "a", status, updatedAt: `saved-${status}`, scheduledDate: "2026-09-17", ...extra } });

test("status moves immediately and acknowledgements preserve other records and concurrent note edits", async () => {
  const f = fixture(), other = f.state.jobs[1], customers = f.state.customers, quote = f.state.jobs[0].quote;
  const saving = f.move("a", "In Progress");
  assert.equal(f.state.jobs[0].status, "In Progress");
  assert.equal(f.requests[0].expectedStatus, "To Do");
  f.edit((state) => ({ ...state, jobs: state.jobs.map((job) => job.id === "a" ? { ...job, serviceBoardNote: "Call back" } : job) }));
  f.requests[0].resolve(saved("In Progress"));
  assert.equal(await saving, true);
  assert.equal(f.state.jobs[0].serviceBoardNote, "Call back");
  assert.equal(f.state.jobs[0].quote, quote);
  assert.equal(f.state.jobs[1], other);
  assert.equal(f.state.customers, customers);
});

test("failed completion restores status while preserving the scheduled date and a concurrent note edit", async () => {
  const f = fixture(), original = f.state.jobs[0];
  const saving = f.move("a", "Completed");
  assert.equal(f.state.jobs[0].scheduledDate, "2026-09-17");
  f.edit((state) => ({ ...state, jobs: [{ ...state.jobs[0], serviceBoardNote: "New note" }, state.jobs[1]] }));
  f.requests[0].reject(new Error("Save failed"));
  assert.equal(await saving, false);
  assert.deepEqual(f.state.jobs[0], { ...original, serviceBoardNote: "New note" });
  assert.deepEqual(f.errors, ["Save failed"]);
});

test("rapid successive drops serialize one job and ignore older acknowledgements", async () => {
  const f = fixture();
  const first = f.move("a", "In Progress"), second = f.move("a", "Completed");
  assert.equal(f.requests.length, 1);
  assert.equal(f.state.jobs[0].status, "Completed");
  f.requests[0].resolve(saved("In Progress")); await first;
  assert.equal(f.state.jobs[0].status, "Completed");
  assert.equal(f.requests[1].expectedStatus, "In Progress");
  f.requests[1].reject(new Error("Second save failed")); await second;
  assert.equal(f.state.jobs[0].status, "In Progress");
  assert.equal(f.state.jobs[0].scheduledDate, "2026-09-17");
});

test("a queued move after failed completion preserves the scheduled date", async () => {
  const f = fixture();
  const first = f.move("a", "Completed"), second = f.move("a", "In Progress");
  f.requests[0].reject(new Error("Completion failed")); await first;
  assert.equal(f.requests[1].expectedStatus, "To Do");
  f.requests[1].resolve(saved("In Progress")); await second;
  assert.equal(f.state.jobs[0].status, "In Progress");
  assert.equal(f.state.jobs[0].scheduledDate, "2026-09-17");
});

test("different jobs persist independently and a conflict restores authoritative status", async () => {
  const f = fixture();
  const first = f.move("a", "In Progress"), second = f.move("b", "Completed");
  assert.equal(f.requests.length, 2);
  const error = new Error("Changed in another session");
  error.currentJob = saved("Completed", { scheduledDate: "" }).job;
  f.requests[0].reject(error); f.requests[1].resolve(saved("Completed", { id: "b" }));
  assert.deepEqual(await Promise.all([first, second]), [false, true]);
  assert.equal(f.state.jobs[0].status, "Completed");
  assert.equal(f.state.jobs[1].status, "Completed");
  assert.equal(f.state.jobs[0].scheduledDate, "2026-09-17");
});

test("status reconciliation does not replace concurrent scheduled date or timestamp edits", async () => {
  const f = fixture();
  const saving = f.move("a", "Completed");
  f.edit((state) => ({ ...state, jobs: [{ ...state.jobs[0], scheduledDate: "2026-10-01", updatedAt: "concurrent" }, state.jobs[1]] }));
  f.requests[0].reject(new Error("Failed")); await saving;
  assert.equal(f.state.jobs[0].status, "To Do");
  assert.equal(f.state.jobs[0].scheduledDate, "2026-10-01");
  assert.equal(f.state.jobs[0].updatedAt, "concurrent");
});

test("a second queued move preserves a scheduled date edit made between the two drops", async () => {
  const f = fixture();
  const first = f.move("a", "Completed");
  f.edit((state) => ({ ...state, jobs: [{ ...state.jobs[0], scheduledDate: "2026-10-01" }, state.jobs[1]] }));
  const second = f.move("a", "In Progress");
  assert.equal(f.state.jobs[0].scheduledDate, "2026-10-01");
  f.requests[0].resolve(saved("Completed", { scheduledDate: "" })); await first;
  f.requests[1].resolve(saved("In Progress", { scheduledDate: "2026-10-01" })); await second;
  assert.equal(f.state.jobs[0].scheduledDate, "2026-10-01");
});

test("status requests use a compact conditional PATCH and reject malformed acknowledgements", async () => {
  let request;
  const fetchWithAuth = async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ result: saved("In Progress") }) }; };
  await requestJobStatusUpdate({ fetchWithAuth, jobId: "a", status: "In Progress", expectedStatus: "To Do" });
  assert.equal(request.url, "/api/jobs/a/status?response=delta");
  assert.deepEqual(JSON.parse(request.options.body), { status: "In Progress", expectedStatus: "To Do" });
  await assert.rejects(requestJobStatusUpdate({ fetchWithAuth, jobId: "wrong", status: "In Progress", expectedStatus: "To Do" }), /Unable to update/);
});

test("service completion retains concurrent job notes and newer maintenance plan edits", () => {
  const f = fixture();
  const plan = { id: "plan-a", planName: "Concurrent plan edit", maintenanceRevision: 8, lastCompletedAt: "previous" };
  const state = { ...f.state, maintenancePlans: [plan] };
  const merged = mergeMaintenanceJobCompletion(state, {
    job: saved("Completed").job,
    maintenancePlan: { id: plan.id, maintenanceRevision: 7, lastCompletedAt: "older-response", completedOccurrences: [] },
  });
  assert.equal(merged.jobs[0].status, "Completed");
  assert.equal(merged.jobs[0].scheduledDate, "2026-09-17");
  assert.equal(merged.jobs[0].serviceBoardNote, "Parts");
  assert.equal(merged.jobs[0].quote, state.jobs[0].quote);
  assert.equal(merged.jobs[1], state.jobs[1]);
  assert.equal(merged.maintenancePlans[0], plan);
});
