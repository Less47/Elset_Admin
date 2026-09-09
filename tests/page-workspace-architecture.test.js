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
  const customerPagesSource = readSource("src/components/customers/CustomerPages.jsx");
  const navigationSource = readSource("src/hooks/useWorkspaceNavigation.js");

  assert.match(appSource, /<CreateJobPage/);
  assert.match(appSource, /<JobDetailsPage/);
  assert.match(navigationSource, /\/jobs\/new/);
  assert.match(navigationSource, /\/jobs\/\$\{encodeURIComponent\(job\.id\)\}/);
  assert.doesNotMatch(customerPagesSource, /JobFormDialog|JobDetailsDialog|JobEditDialog/);
});

test("all existing job-opening surfaces retain the centralized page navigator", () => {
  const shellSource = readSource("src/components/app/WorkspaceShell.jsx");
  const customerPagesSource = readSource("src/components/customers/CustomerPages.jsx");
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

  assert.match(customerPagesSource, /<CustomerWorkspace[\s\S]*?onOpenJob=\{actions.handleOpenJob\}/);
  assert.match(customerPagesSource, /<SiteWorkspace[\s\S]*?onOpenJob=\{actions.handleOpenJob\}/);
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
    "src/components/customers/CustomerFormPage.jsx",
    "src/components/sites/SiteWorkspace.jsx",
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

test("database pages share accessible responsive and desktop page controls", () => {
  const sharedSource = readSource("src/components/shared/ResponsivePageControls.jsx");
  assert.match(sharedSource, /export function ResponsivePageControls/);
  assert.match(sharedSource, /export function DesktopPageControls/);
  assert.match(sharedSource, /export function DesktopControlField/);
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
  ]) {
    const source = readSource(relativePath);
    assert.match(source, /<ResponsivePageControls/);
    assert.match(source, /<DesktopPageControls/);
    assert.doesNotMatch(source, /floating-page-toolbar[^"]*hidden[^"]*xl:block/);
  }

  const customerSource = readSource("src/components/customers/CustomerManager.jsx");
  const siteSource = readSource("src/components/sites/SiteManager.jsx");
  for (const source of [customerSource, siteSource]) {
    assert.match(source, /<ViewModeToggle compact/);
    assert.doesNotMatch(source, /<LayoutGrid|<List/);
  }

  const styles = readSource("src/index.css");
  assert.match(styles, /--page-controls-search-width: 20rem/);
  assert.match(styles, /--page-controls-gap: 0\.625rem/);
  assert.match(styles, /\.page-controls__right[\s\S]*?margin-left: auto/);
  assert.match(styles, /\.page-controls__field :is\(input, button\[role="combobox"\]\)[\s\S]*?min-width: 0 !important;[\s\S]*?max-width: 100% !important;/);
  assert.match(styles, /\.page-controls__view-button\.is-active/);
  assert.match(styles, /\.page-controls__filter--small[\s\S]*?width: 7\.5rem/);
  assert.match(styles, /\.page-controls__filter--medium,[\s\S]*?width: 9rem/);
  assert.match(styles, /\.page-controls__filter--large[\s\S]*?width: 11rem/);

  const mapSource = readSource("src/components/map/JobsMapManager.jsx");
  assert.match(mapSource, /<ResponsivePageControls/);
  assert.match(mapSource, /map-desktop-filter-bar[^"]*hidden[^"]*xl:block/);
});

test("database pages declare the shared semantic phone record system and desktop result boundary", () => {
  const sharedSource = readSource("src/components/shared/MobileRecordList.jsx");
  const layoutHookSource = readSource("src/hooks/useMobileRecordLayout.js");

  assert.match(layoutHookSource, /export function useMobileRecordLayout/);
  assert.match(layoutHookSource, /max-width: 47\.999rem/);
  assert.match(sharedSource, /export function MobileRecordList/);
  assert.match(sharedSource, /<ul/);
  assert.match(sharedSource, /data-mobile-record-list/);
  assert.match(sharedSource, /export function MobileRecordCard/);
  assert.match(sharedSource, /<article/);
  assert.match(sharedSource, /aria-labelledby/);
  assert.match(sharedSource, /data-mobile-record-card/);
  assert.match(sharedSource, /export function MobileRecordActions/);
  assert.match(sharedSource, /min-h-11/);

  for (const relativePath of [
    "src/components/customers/CustomerManager.jsx",
    "src/components/sites/SiteManager.jsx",
    "src/components/jobs/JobHistoryManager.jsx",
    "src/components/invoices/InvoiceManager.jsx",
    "src/components/maintenance/MaintenanceManager.jsx",
    "src/components/staff/StaffManager.jsx",
    "src/components/inventory/InventoryManager.jsx",
  ]) {
    const source = readSource(relativePath);
    assert.match(source, /useMobileRecordLayout\(\)/);
    assert.match(source, /<MobileRecordList/);
    assert.match(source, /<MobileRecordCard/);
    assert.match(source, /data-desktop-record-results/);
  }
});

test("Map owns an edge-to-edge, resize-aware workspace instead of a contained card", () => {
  const shellSource = readSource("src/components/app/WorkspaceShell.jsx");
  const mapSource = readSource("src/components/map/JobsMapManager.jsx");

  assert.match(shellSource, /mapWorkspaceOpen/);
  assert.match(shellSource, /map-workspace-shell[^"]*lg:pl-\[var\(--sidebar-width\)\]/);
  assert.match(mapSource, /data-map-workspace/);
  assert.match(mapSource, /data-map-canvas/);
  assert.match(mapSource, /map-filter-surface/);
  assert.match(mapSource, /ResizeObserver/);
  assert.match(mapSource, /invalidateSize/);
  assert.match(mapSource, /L\.control\.zoom\(\{ position: "bottomright" \}\)/);
  assert.doesNotMatch(mapSource, /<Card|<CardContent|h-\[60vh\]|calc\(100vh-18rem\)/);
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
