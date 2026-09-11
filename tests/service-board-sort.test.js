import assert from "node:assert/strict";
import test from "node:test";
import { sortJobsForColumn } from "../src/components/service-board/service-board-utils.js";

const ids = (jobs) => jobs.map((job) => job.id);
const jobs = [
  { id: "old", jobNumber: 50, createdAt: "2026-01-01", updatedAt: "2026-09-11", customerName: "Beta", urgency: "Low", scheduledDate: "2026-09-15" },
  { id: "new", jobNumber: 100, createdAt: "2026-09-10", updatedAt: "2026-09-10", customerName: "Alpha", urgency: "High", scheduledDate: "2026-09-14" },
];

test("Service Board Recent uses creation order and Oldest reverses it without changing input", () => {
  const before = structuredClone(jobs);
  assert.deepEqual(ids(sortJobsForColumn(jobs)), ["new", "old"]);
  assert.deepEqual(ids(sortJobsForColumn(jobs, "oldest")), ["old", "new"]);
  assert.deepEqual(jobs, before);
});

test("notes, edits, invoice activity and completing an old job cannot change Recent order", () => {
  for (const patch of [{ notes: [{ text: "New note", createdAt: "2026-09-12" }] }, { title: "Edited" }, { invoice: { items: [], sentHistory: [{ sentAt: "2026-09-12" }] } }, { status: "Completed" }]) {
    const changed = [{ ...jobs[0], ...patch, updatedAt: "2099-01-01" }, jobs[1]];
    assert.deepEqual(ids(sortJobsForColumn(changed, "recent")), ["new", "old"]);
  }
});

test("creation ties use job numbers and missing legacy dates never use activity", () => {
  const records = [{ id: "missing", jobNumber: 400, updatedAt: "2099-01-01" }, { id: "invalid", jobNumber: 399, createdAt: "invalid", updatedAt: "2099-01-02" }, { ...jobs[1], id: "tie", jobNumber: 101 }, jobs[1]];
  assert.deepEqual(ids(sortJobsForColumn(records, "recent")), ["tie", "new", "missing", "invalid"]);
  assert.deepEqual(ids(sortJobsForColumn(records, "oldest")), ["invalid", "missing", "new", "tie"]);
});

test("other Service Board sorts retain their primary ordering and activity tie-breaks", () => {
  for (const mode of ["urgency", "customer", "scheduled"]) assert.deepEqual(ids(sortJobsForColumn(jobs, mode)), ["new", "old"]);
  for (const mode of ["urgency", "customer", "value"]) {
    const tied = jobs.map((job) => ({ ...job, urgency: "High", customerName: "Same", invoice: { items: [{ qty: 1, rate: 10 }] } }));
    assert.deepEqual(ids(sortJobsForColumn(tied, mode)), ["old", "new"]);
  }
  assert.deepEqual(ids(sortJobsForColumn([{ ...jobs[0], invoice: { items: [{ qty: 1, rate: 10 }] } }, { ...jobs[1], quote: { items: [{ qty: 1, rate: 20 }] } }], "value")), ["new", "old"]);
});
