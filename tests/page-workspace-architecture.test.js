import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("substantial job workflows use URL-backed pages instead of job dialogs", () => {
  const appSource = readSource("src/App.jsx");
  const dialogsSource = readSource("src/components/app/WorkspaceDialogs.jsx");
  const navigationSource = readSource("src/hooks/useWorkspaceNavigation.js");

  assert.match(appSource, /<CreateJobPage/);
  assert.match(appSource, /<JobDetailsPage/);
  assert.match(navigationSource, /\/jobs\/new/);
  assert.match(navigationSource, /\/jobs\/\$\{encodeURIComponent\(job\.id\)\}/);
  assert.doesNotMatch(dialogsSource, /JobFormDialog|JobDetailsDialog|JobEditDialog/);
});

test("all existing job-opening surfaces retain the centralized page navigator", () => {
  const shellSource = readSource("src/components/app/WorkspaceShell.jsx");
  const dialogsSource = readSource("src/components/app/WorkspaceDialogs.jsx");
  const actionsSource = readSource("src/hooks/useWorkspaceActions.js");

  for (const component of [
    "OfficeBoard",
    "MobileServiceBoard",
    "JobHistoryManager",
    "CalendarManager",
    "InvoiceManager",
    "MaintenanceManager",
    "JobsMapManager",
  ]) {
    assert.match(shellSource, new RegExp(`<${component}[\\s\\S]*?onOpenJob=\\{handleOpenJob\\}`));
  }

  assert.match(dialogsSource, /<CustomerProfileDialog[\s\S]*?onOpenJob=\{handleOpenJob\}/);
  assert.match(dialogsSource, /<SiteProfileDialog[\s\S]*?onOpenJob=\{handleOpenJob\}/);
  assert.match(actionsSource, /function handleOpenJob\(job\)[\s\S]*?onNavigateToJob\?\.\(job\)/);
});

test("Create Job continues to use the record-specific jobs endpoint", () => {
  const actionsSource = readSource("src/hooks/useWorkspaceActions.js");
  const pageSource = readSource("src/components/jobs/CreateJobPage.jsx");

  assert.match(actionsSource, /path: "\/api\/jobs"/);
  assert.match(pageSource, /onSave\(\{/);
  assert.doesNotMatch(pageSource, /\/api\/app-state/);
});

test("site OC numbers and job client references stay separate in record workflows", () => {
  const createJobSource = readSource("src/components/jobs/CreateJobPage.jsx");
  const jobDetailsSource = readSource("src/components/jobs/JobDetailsPage.jsx");
  const actionsSource = readSource("src/hooks/useWorkspaceActions.js");

  assert.match(createJobSource, /htmlFor="new-site-oc-number">OC number/);
  assert.match(createJobSource, /placeholder="e\.g\. PS123456"/);
  assert.match(createJobSource, /htmlFor="job-client-reference">Client reference \/ PO number/);
  assert.match(createJobSource, /placeholder="Optional purchase order or client reference"/);
  assert.doesNotMatch(createJobSource, /ocNumber: defaultSite\.ocNumber/);
  assert.doesNotMatch(createJobSource, /ocNumber: site\.ocNumber/);
  assert.doesNotMatch(actionsSource, /job\.ocNumber \|\| normalizedSiteInput\?\.ocNumber/);

  assert.match(jobDetailsSource, /<InfoItem label="OC number">\{currentJobSite\?\.ocNumber/);
  assert.doesNotMatch(jobDetailsSource, /<InfoItem label="OC number">\{job\.ocNumber/);
  assert.match(jobDetailsSource, /htmlFor="edit-job-client-reference">Client reference \/ PO number/);
  assert.match(jobDetailsSource, /This belongs to the site and is managed from the Site profile\./);
});

test("site forms consistently describe OC number as a property reference", () => {
  for (const relativePath of [
    "src/components/customers/CustomerCreateDialog.jsx",
    "src/components/customers/CustomerProfileDialog.jsx",
    "src/components/sites/SiteProfileDialog.jsx",
  ]) {
    const source = readSource(relativePath);
    assert.match(source, /label="OC number"/);
    assert.match(source, /placeholder="e\.g\. PS123456"/);
    assert.match(source, /Owners Corporation \/ plan reference for this property\./);
    assert.doesNotMatch(source, /Optional (?:invoice|client order\/control) reference/);
  }
});

test("quote and invoice surfaces label the legacy job field as a client reference", () => {
  const documentEditorSource = readSource("src/components/documents/DocumentEditor.jsx");
  const invoiceManagerSource = readSource("src/components/invoices/InvoiceManager.jsx");
  const pdfSource = readSource("quote-pdf.js");

  assert.match(documentEditorSource, /label="Client reference \/ PO number"/);
  assert.match(invoiceManagerSource, /Client ref \{row\.job\.ocNumber\}/);
  assert.match(pdfSource, /Client reference: \$\{model\.ocNumber\}/);
  assert.doesNotMatch(documentEditorSource, /label="OC number"/);
  assert.doesNotMatch(pdfSource, /OC Number:/);
});

test("supplier manual loading, matching, and UI remain removed", () => {
  for (const relativePath of [
    "src/hooks/useSupplierManuals.js",
    "src/lib/supplier-manuals.js",
    "src/components/shared/SupplierManualMatches.jsx",
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), false);
  }

  for (const relativePath of [
    "src/App.jsx",
    "src/components/app/WorkspaceShell.jsx",
    "src/components/jobs/JobDetailsPage.jsx",
    "src/components/service-board/MobileJobCard.jsx",
    "src/components/service-board/MobileServiceBoard.jsx",
    "src/components/service-board/OfficeBoard.jsx",
    "src/components/service-board/service-board-utils.js",
    "src/hooks/useWorkspaceViewModel.js",
  ]) {
    assert.doesNotMatch(readSource(relativePath), /supplier.?manual|manualMatches/i);
  }
});

test("database pages share accessible responsive page controls without replacing desktop toolbars", () => {
  const sharedSource = readSource("src/components/shared/ResponsivePageControls.jsx");
  assert.match(sharedSource, /export function ResponsivePageControls/);
  assert.match(sharedSource, /export function MobileFilterSheet/);
  assert.match(sharedSource, /onCloseAutoFocus/);
  assert.match(sharedSource, /safe-area-inset-bottom/);
  assert.match(sharedSource, /motion-reduce/);
  assert.match(sharedSource, /aria-haspopup="dialog"/);
  assert.match(sharedSource, /aria-live="polite"/);

  for (const relativePath of [
    "src/components/customers/CustomerManager.jsx",
    "src/components/sites/SiteManager.jsx",
    "src/components/jobs/JobHistoryManager.jsx",
    "src/components/invoices/InvoiceManager.jsx",
    "src/components/maintenance/MaintenanceManager.jsx",
    "src/components/staff/StaffManager.jsx",
    "src/components/inventory/InventoryManager.jsx",
    "src/components/map/JobsMapManager.jsx",
  ]) {
    const source = readSource(relativePath);
    assert.match(source, /<ResponsivePageControls/);
    assert.match(source, /floating-page-toolbar[^"]*hidden[^"]*xl:block/);
  }
});

test("secondary page filters move into shared sheets while Staff avoids a redundant filter", () => {
  for (const relativePath of [
    "src/components/customers/CustomerManager.jsx",
    "src/components/sites/SiteManager.jsx",
    "src/components/jobs/JobHistoryManager.jsx",
    "src/components/invoices/InvoiceManager.jsx",
    "src/components/maintenance/MaintenanceManager.jsx",
    "src/components/inventory/InventoryManager.jsx",
    "src/components/map/JobsMapManager.jsx",
  ]) {
    assert.match(readSource(relativePath), /<MobileFilterSheet/);
  }

  const staffSource = readSource("src/components/staff/StaffManager.jsx");
  assert.doesNotMatch(staffSource, /<MobileFilterSheet|<FilterButton/);
});
