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
