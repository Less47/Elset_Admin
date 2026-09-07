import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { filterQueueJobs, groupCalendarJobs, isCalendarDate } from "../src/components/calendar/calendar-utils.js";

const jobs = [
  { id: "todo", jobNumber: 212, status: "To Do", customerName: "Massimo Test", jobAddress: "12 Sample Road, Carlton", title: "Gate repair", urgency: "High", scheduledDate: "" },
  { id: "progress", jobNumber: 205, status: "In Progress", customerName: "MBCM", jobAddress: "31 Charnwood Road", title: "Shutter automation", urgency: "Medium", scheduledDate: "2026-09-15", assignedTechnicianName: "Jordan" },
  { id: "done", jobNumber: 179, status: "Completed", customerName: "Natasha", title: "Electrical work", scheduledDate: "2026-09-15" },
];

test("the scheduling queue includes both open statuses and excludes Completed", () => {
  assert.deepEqual(filterQueueJobs(jobs).map((job) => job.id), ["todo", "progress"]);
  assert.deepEqual(filterQueueJobs([]), []);
});

test("queue search covers numbers, customers, titles, addresses and technicians", () => {
  for (const search of ["212", " MASSIMO ", "gate", "carlton"]) assert.deepEqual(filterQueueJobs(jobs, { search }).map((job) => job.id), ["todo"]);
  for (const search of ["205", "MBCM", "shutter", "charnwood", "Jordan"]) assert.deepEqual(filterQueueJobs(jobs, { search }).map((job) => job.id), ["progress"]);
  assert.deepEqual(filterQueueJobs(jobs, { search: "Natasha" }), []);
});

test("queue filters combine urgency and scheduled state without changing jobs", () => {
  const original = structuredClone(jobs);
  assert.deepEqual(filterQueueJobs(jobs, { schedule: "unscheduled", urgency: "High" }).map((job) => job.id), ["todo"]);
  assert.deepEqual(filterQueueJobs(jobs, { schedule: "scheduled" }).map((job) => job.id), ["progress"]);
  assert.deepEqual(filterQueueJobs(jobs, { schedule: "scheduled", urgency: "High" }), []);
  assert.deepEqual(jobs, original);
});

test("calendar groups all scheduled statuses and retains crowded days", () => {
  const crowded = Array.from({ length: 12 }, (_, index) => ({ ...jobs[0], id: `job-${index}`, jobNumber: 300 + index, scheduledDate: "2026-09-15" }));
  const source = [...jobs, ...crowded];
  const original = structuredClone(source);
  const grouped = groupCalendarJobs(source, (value) => value);
  assert.equal(grouped.size, 1);
  assert.equal(grouped.get("2026-09-15").length, 14);
  assert.equal(grouped.get("2026-09-15").at(-1).status, "Completed");
  assert.deepEqual(groupCalendarJobs([...source].reverse(), (value) => value).get("2026-09-15").map((job) => job.id), grouped.get("2026-09-15").map((job) => job.id));
  assert.deepEqual(source, original);
});

test("calendar dates validate month lengths and leap days", () => {
  for (const value of ["2026-09-15", "2028-02-29", "2026-12-31"]) assert.equal(isCalendarDate(value), true);
  for (const value of ["", null, "2026-02-29", "2026-04-31", "2026-13-01", "2026-09-00", "2026-09-15T00:00:00Z"]) assert.equal(isCalendarDate(value), false);
});

test("date-only labels keep the chosen day in eastern, western and DST timezones", () => {
  const moduleUrl = new URL("../src/components/calendar/calendar-utils.js", import.meta.url).href;
  for (const timezone of ["Australia/Sydney", "Pacific/Honolulu", "America/Los_Angeles", "Pacific/Auckland"]) {
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", `import { formatCalendarDate } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(["2026-09-15", "2026-10-04"].map(value => formatCalendarDate(value))));`], { env: { ...process.env, TZ: timezone }, encoding: "utf8", windowsHide: true });
    assert.deepEqual(JSON.parse(result), ["15 Sept 2026", "4 Oct 2026"], timezone);
  }
});
