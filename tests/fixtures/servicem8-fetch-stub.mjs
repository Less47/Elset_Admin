// Loaded only by the synthetic Playwright server. No ServiceM8 network calls.
import fs from "node:fs";
const snapshot = JSON.parse(fs.readFileSync(new URL("../../fixtures/servicem8-import-snapshot.json", import.meta.url), "utf8"));
snapshot.contacts.push({ ...snapshot.contacts[0], uuid: "browser-secondary", is_primary_contact: "0", is_billing_contact: "1", job_title: "Facilities Manager" });
const endpoints = { "company.json": "clients", "companycontact.json": "contacts", "job.json": "jobs", "jobactivity.json": "activities", "jobmaterial.json": "materials", "jobpayment.json": "payments", "note.json": "notes", "staff.json": "staff" };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const parsed = new URL(String(url));
  if (parsed.hostname !== "api.servicem8.com") return originalFetch(url, options);
  const key = endpoints[parsed.pathname.split("/").at(-1)];
  return new Response(JSON.stringify(key ? snapshot[key] : { error: "Unexpected synthetic endpoint" }), { status: key ? 200 : 404, headers: { "Content-Type": "application/json", "x-next-cursor": "" } });
};
