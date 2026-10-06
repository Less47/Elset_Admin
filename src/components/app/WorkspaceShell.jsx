import { FilterPopover, PagePrimaryAction } from "@/components/shared/ResponsivePageControls";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PageWorkspace, PageTopBar, PageBody } from "@/components/workspace/PageWorkspace";
import { Maximize2, Minimize2, Plus } from "lucide-react";
import WorkspaceSidebar from "@/components/app/WorkspaceSidebar";
import MobileWorkspaceNavigation from "@/components/app/MobileWorkspaceNavigation";
import CalendarManager from "@/components/calendar/CalendarManager";
import CustomerManager from "@/components/customers/CustomerManager";
import InventoryManager from "@/components/inventory/InventoryManager";
import InvoiceManager from "@/components/invoices/InvoiceManager";
import JobHistoryManager from "@/components/jobs/JobHistoryManager";
import MaintenanceManager from "@/components/maintenance/MaintenanceManager";
import RecycleBinPanel from "@/components/recycle-bin/RecycleBinPanel";
import JobBillingFilter from "@/components/service-board/JobBillingFilter";
import MobileServiceBoard from "@/components/service-board/MobileServiceBoard";
import JobNoteEditor from "@/components/service-board/JobNoteEditor";
import { useJobNoteEditor } from "@/components/service-board/useJobNoteEditor";
import { OfficeBoard, ServiceBoardTagLegend, ServiceBoardTomorrowPanel } from "@/components/service-board/OfficeBoard";
import { TOMORROW_VIEW } from "@/components/service-board/service-board-utils";
import SettingsManager from "@/components/settings/SettingsManager";
import StaffManager from "@/components/staff/StaffManager";
import SiteManager from "@/components/sites/SiteManager";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { activeAccountingProvider } from "@/lib/addons";
import {
  addMonths,
  buildCustomerSites,
  formatDate,
  getCalendarDays,
  getInvoicePaymentSummary,
  getInvoiceStatus,
  getRecycleBinExpiryDate,
  getSiteDisplayName,
  normalizeDocument,
  parseDateInputValue,
  toDateInputValue,
  toTimestamp,
} from "@/lib/app-support";

const GoogleJobsMap = lazy(() => import("@/components/map/GoogleJobsMap"));
const ReportsAnalytics = lazy(() => import("@/components/statistics/ReportsAnalytics"));

export default function WorkspaceShell({ auth, chrome, data, derived, actions, workspacePage = null, personalPreferences, workspaceAddons, settingsPersistence, onSettingsPreview }) {
  const [mobileServiceBoardView, setMobileServiceBoardView] = useState("To Do");
  const isDesktopLayout = useMediaQuery("(min-width: 64rem)");
  const isThreeColumnBoard = useMediaQuery("(min-width: 48rem)");
  const accountingProvider = activeAccountingProvider(workspaceAddons.addons);
  const { authError, authUser, canManageBusiness, handleLogout, isAdmin, isAuthenticated, isTechnician } = auth;
  const {
    activeSection,
    activeSettingsTab,
    activeTemplateType,
    officeSearch,
    serviceBoardColumnSorts,
    serviceBoardColumnViews,
    serviceBoardTomorrowPanelOpen,
    setActiveSection,
    setActiveSettingsTab,
    setActiveTemplateType,
    openCreateCustomer,
    openCreateJob,
    setOfficeSearch,
    setServiceBoardColumnSorts,
    setServiceBoardColumnViews,
    setServiceBoardFullScreen,
    setServiceBoardTomorrowPanelOpen,
    setShowHighUrgencyOnly,
    setShowServiceBoardTagLabels,
    showHighUrgencyOnly,
    billingTypeFilter,
    setBillingTypeFilter,
    showServiceBoardTagLabels,
  } = chrome;
  const {
    currentSection,
    filteredJobs,
    isServiceBoardFullScreen,
    themePalette,
    themeSettings,
    visibleSideNavItems,
  } = derived;
  const {
    handleCreateInventoryItem,
    handleCreateStaff,
    handleCreateSiteProfile,
    handleDeleteInventoryItem,
    handleEmptyDeletedCustomers,
    handleEmptyDeletedJobs,
    handleGenerateMaintenanceJob,
    handleOpenCustomerProfile,
    handleOpenDoc,
    handleOpenJob,
    handlePlanJobForTomorrow,
    handleOpenSentDocumentCopy,
    handleOpenSiteProfile,
    handleRemoveAllJobsFromTomorrow,
    handleRemoveJobFromTomorrow,
    handleRestoreDeletedCustomer,
    handleRestoreDeletedJob,
    handleSaveStaffLoginAccount,
    handleScheduleJob,
    handlePreviewDayReschedule,
    handleRescheduleDayJobs,
    handleStatusChange,
    handleUpdateInventoryItem,
    handleUpdateInvoicePayment,
    handleUpdateStaff,
  } = actions;
  const roleMenuLabel = isTechnician ? "Technician" : isAdmin ? "Admin" : "Office";
  const desktopServiceBoardFullScreen = isThreeColumnBoard && isServiceBoardFullScreen;
  const mapWorkspaceOpen = !workspacePage && canManageBusiness && activeSection === "map";
  const calendarWorkspaceOpen = !workspacePage && canManageBusiness && activeSection === "calendar";
  const jobNotes = useJobNoteEditor({ jobs: data.jobs, onSave: actions.handleSaveServiceBoardNote });
  const boardFocus = useRef(null);
  const recordOpen = Boolean(workspacePage);
  const shellRef = useRef(null);
  const mobileNavigationRef = useRef(null);
  useLayoutEffect(() => {
    // Measure navigation including safe areas and text zoom. Map retains its
    // independent sizing/overflow contract.
    if (mapWorkspaceOpen) return;
    const shell = shellRef.current;
    const navigation = mobileNavigationRef.current;
    const update = () => shell?.style.setProperty("--page-navigation-height", `${navigation?.getBoundingClientRect().height || 0}px`);
    update();
    const observer = new ResizeObserver(update);
    if (navigation) observer.observe(navigation);
    return () => { observer.disconnect(); shell?.style.removeProperty("--page-navigation-height"); };
  }, [isDesktopLayout, recordOpen, mapWorkspaceOpen]);
  useEffect(() => {
    if (!recordOpen && activeSection === "service-board" && boardFocus.current?.isConnected) {
      boardFocus.current.focus({ preventScroll: true });
    }
  }, [recordOpen, activeSection]);

  const handleMobileNavigate = (sectionId) => {
    const navigationStarted = setActiveSection(sectionId);
    if (navigationStarted !== false && sectionId === "service-board") setMobileServiceBoardView("To Do");
    return navigationStarted;
  };

  const renderServiceBoardControls = (tone = "panel") => {
    const isHeroTone = tone === "hero";
    const searchInputClassName = isHeroTone
      ? "min-w-0 flex-1 border-border bg-card/95 text-foreground placeholder:text-muted-foreground shadow-sm"
      : "min-w-0 flex-1";
    const fullScreenButtonClassName = isHeroTone
      ? "rounded-2xl border-white/30 bg-card/95 text-foreground hover:bg-card"
      : "rounded-2xl bg-card";

    return (
      <div className="grid gap-3">
        <div className="flex w-full flex-col gap-2 md:flex-row md:items-center" data-service-board-primary-controls>
          <Input
            className={`h-11 ${searchInputClassName}`}
            aria-label="Search jobs"
            placeholder="Search jobs, customer, address..."
            value={officeSearch}
            onChange={(event) => setOfficeSearch(event.target.value)}
          />

          <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
            <FilterPopover activeCount={Number(showHighUrgencyOnly) + Number(billingTypeFilter !== "all")} onReset={() => { setShowHighUrgencyOnly(false); setBillingTypeFilter("all"); }}>
              <JobBillingFilter value={billingTypeFilter} onChange={setBillingTypeFilter} />
              <label className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox checked={showHighUrgencyOnly} onCheckedChange={(checked) => setShowHighUrgencyOnly(Boolean(checked))} />
              <span className="whitespace-nowrap text-sm">High urgency only</span>
            </label></FilterPopover>
            <PagePrimaryAction
              variant="outline"
              className={`${fullScreenButtonClassName} whitespace-nowrap px-3`}
              onClick={() => setServiceBoardFullScreen((prev) => !prev)}
            >
              {isServiceBoardFullScreen ? (
                <>
                  <Minimize2 className="mr-2 h-4 w-4" /> Exit Full Screen
                </>
              ) : (
                <>
                  <Maximize2 className="mr-2 h-4 w-4" /> Full Screen
                </>
              )}
            </PagePrimaryAction>
            {canManageBusiness ? (
              <PagePrimaryAction className="whitespace-nowrap rounded-2xl hover:opacity-95" style={themePalette.primaryButton} onClick={() => openCreateJob()}>
                <Plus className="mr-2 h-4 w-4" /> New Job
              </PagePrimaryAction>
            ) : null}
          </div>
        </div>

        <ServiceBoardTagLegend
          accountingProvider={accountingProvider}
          noteEditMode={jobNotes.active}
          onToggleNoteEditMode={jobNotes.toggle}
          tone={isHeroTone ? "hero" : "default"}
          showTagLabels={showServiceBoardTagLabels}
          onToggleShowTagLabels={setShowServiceBoardTagLabels}
        />
      </div>
    );
  };

  const noteStatus = <>
            {jobNotes.pendingCount > 0 ? <p role="status" className="mb-2 text-xs text-text-secondary">Saving job note…</p> : null}
            {jobNotes.failures.map((failure) => (
              <div key={failure.jobId} role="alert" className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-status-danger-border bg-status-danger-surface p-3 text-sm text-status-danger">
                <span>Job #{failure.jobNumber}: {failure.message} Your draft is kept for retry.</span>
                <Button type="button" variant="outline" onClick={(event) => jobNotes.retry(failure, event)}>Retry note</Button>
              </div>
            ))}
  </>;

  return (
    <div ref={shellRef} className={mapWorkspaceOpen || calendarWorkspaceOpen ? `${mapWorkspaceOpen ? "map" : "calendar"}-workspace-app fixed inset-0 flex min-h-0 flex-col overflow-hidden lg:block` : "contents"}>
      {!isDesktopLayout && !workspacePage ? (
        <MobileWorkspaceNavigation
          ref={mobileNavigationRef}
          activeSection={activeSection}
          authUser={authUser}
          canManageBusiness={canManageBusiness}
          currentSection={currentSection}
          items={visibleSideNavItems}
          onLogout={handleLogout}
          onNavigate={handleMobileNavigate}
          onNewJob={() => openCreateJob()}
          onOpenTomorrow={() => isThreeColumnBoard ? setServiceBoardTomorrowPanelOpen((open) => !open) : setMobileServiceBoardView(TOMORROW_VIEW)}
          roleLabel={roleMenuLabel}
          workspaceLogoUrl={themeSettings.workspaceLogoUrl}
          themePalette={themePalette}
          tomorrowCount={derived.tomorrowJobs.length}
          tomorrowSelected={isThreeColumnBoard ? serviceBoardTomorrowPanelOpen : mobileServiceBoardView === TOMORROW_VIEW}
        />
      ) : null}

      {!desktopServiceBoardFullScreen ? (
        <WorkspaceSidebar
          activeSection={activeSection}
          items={visibleSideNavItems}
          authUser={authUser}
          isAuthenticated={isAuthenticated}
          themeSettings={themeSettings}
          onLogout={handleLogout}
          onNavigate={(sectionId) => {
            const navigationStarted = setActiveSection(sectionId);
            if (navigationStarted !== false && sectionId === "settings" && !activeSettingsTab) setActiveSettingsTab("preferences");
          }}
        />
      ) : null}

      <div
        className={
          workspacePage
            ? "min-w-0 lg:pl-[var(--sidebar-width)]"
            : desktopServiceBoardFullScreen
            ? "workspace-page-column workspace-page-column--fullscreen min-w-0"
            : mapWorkspaceOpen
            ? "map-workspace-shell min-h-0 min-w-0 flex-1 overflow-hidden lg:h-full lg:pl-[var(--sidebar-width)]"
            : calendarWorkspaceOpen
            ? "calendar-workspace-shell min-h-0 min-w-0 flex-1 overflow-hidden lg:h-full lg:pl-[var(--sidebar-width)]"
            : "workspace-page-column min-w-0 lg:pl-[var(--sidebar-width)]"
        }
      >
        {workspacePage}
        {personalPreferences?.error ? (
          <div role="alert" className="m-3 flex flex-wrap items-center gap-2 rounded-lg border border-status-danger-border bg-status-danger-surface p-3 text-sm text-status-danger">
            <span>Personal preferences could not be synced. {personalPreferences.error}</span>
            <Button type="button" variant="outline" onClick={personalPreferences.retry}>Retry personal preferences</Button>
          </div>
        ) : null}

        <div
          className={workspacePage ? undefined : mapWorkspaceOpen || calendarWorkspaceOpen ? "relative h-full min-h-0" : "contents"}
          hidden={Boolean(workspacePage)}
          aria-hidden={workspacePage ? true : undefined}
          onFocusCapture={(event) => {
            if (activeSection === "service-board") boardFocus.current = event.target;
          }}
        >
        {authError ? (
          <Card className={mapWorkspaceOpen
            ? "absolute bottom-4 left-4 z-[1100] max-w-[min(30rem,calc(100%-2rem))] rounded-xl border-status-warning-border bg-status-warning-surface shadow-lg"
            : "rounded-3xl border-status-warning-border bg-status-warning-surface"}
          >
            <CardContent className="p-4 text-sm text-status-warning">
              {authError}
            </CardContent>
          </Card>
        ) : null}

        {activeSection === "service-board" ? (
          <div className="min-w-0">
            {jobNotes.editor ? <JobNoteEditor
              key={jobNotes.editor.jobId}
              editor={jobNotes.editor}
              existingNote={data.jobs.find((job) => job.id === jobNotes.editor.jobId)?.serviceBoardNote}
              onClose={jobNotes.close}
              onSave={jobNotes.save}
            /> : null}
            {isThreeColumnBoard ? (
              <>
                <ServiceBoardTomorrowPanel
                  noteEditMode={jobNotes.active}
                  onEditNote={jobNotes.open}
                  jobs={derived.tomorrowJobs}
                  open={serviceBoardTomorrowPanelOpen}
                  tomorrowDate={derived.tomorrowPlanningDate}
                  onOpenChange={setServiceBoardTomorrowPanelOpen}
                  onOpenJob={handleOpenJob}
                  onRemoveAllJobs={handleRemoveAllJobsFromTomorrow}
                  onRemoveJob={handleRemoveJobFromTomorrow}
                  formatDate={formatDate}
                />

                <PageWorkspace data-desktop-service-board-layout>
                  <PageTopBar data-service-board-toolbar innerClassName="p-panel">
                    {renderServiceBoardControls("hero")}
                  </PageTopBar>
                  <PageBody className="space-y-4">
                    {noteStatus}
                  <OfficeBoard
                    accountingProvider={accountingProvider}
                    noteEditMode={jobNotes.active}
                    onEditNote={jobNotes.open}
                    jobs={filteredJobs}
                    onDropJob={handleStatusChange}
                    onOpenJob={handleOpenJob}
                    allowDragging
                    columnSortModes={serviceBoardColumnSorts}
                    columnViewModes={serviceBoardColumnViews}
                    onPlanJobForTomorrow={handlePlanJobForTomorrow}
                    showTagLabels={showServiceBoardTagLabels}
                    getInvoiceStatus={getInvoiceStatus}
                    formatDate={formatDate}
                    tomorrowPlanningDate={derived.tomorrowPlanningDate}
                    officeSearch={officeSearch}
                    showHighUrgencyOnly={showHighUrgencyOnly}
                    billingTypeFilter={billingTypeFilter}
                    onColumnSortModeChange={(status, sortMode) =>
                      setServiceBoardColumnSorts((prev) =>
                        prev[status] === sortMode
                          ? prev
                          : {
                              ...prev,
                              [status]: sortMode,
                            }
                      )
                    }
                    onColumnViewModeChange={(status, viewMode) =>
                      setServiceBoardColumnViews((prev) =>
                        prev[status] === viewMode
                          ? prev
                          : {
                              ...prev,
                              [status]: viewMode,
                            }
                      )
                    }
                  />
                  </PageBody>
                </PageWorkspace>
              </>
            ) : (
              <MobileServiceBoard
                billingTypeFilter={billingTypeFilter}
                onBillingTypeChange={setBillingTypeFilter}
                accountingProvider={accountingProvider}
                noteStatus={noteStatus}
                noteEditMode={jobNotes.active}
                onToggleNoteEditMode={jobNotes.toggle}
                onEditNote={jobNotes.open}
                canManageTomorrow={canManageBusiness}
                columnSortModes={serviceBoardColumnSorts}
                formatDate={formatDate}
                getInvoiceStatus={getInvoiceStatus}
                jobs={filteredJobs}
                officeSearch={officeSearch}
                onColumnSortModeChange={(status, sortMode) =>
                  setServiceBoardColumnSorts((prev) =>
                    prev[status] === sortMode ? prev : { ...prev, [status]: sortMode }
                  )
                }
                onOpenJob={handleOpenJob}
                onPlanJobForTomorrow={handlePlanJobForTomorrow}
                onRemoveAllJobsFromTomorrow={handleRemoveAllJobsFromTomorrow}
                onRemoveJobFromTomorrow={handleRemoveJobFromTomorrow}
                onSearchChange={setOfficeSearch}
                onSelectedViewChange={setMobileServiceBoardView}
                onShowTagLabelsChange={setShowServiceBoardTagLabels}
                onStatusChange={handleStatusChange}
                onUrgencyChange={setShowHighUrgencyOnly}
                showHighUrgencyOnly={showHighUrgencyOnly}
                showTagLabels={showServiceBoardTagLabels}
                selectedView={mobileServiceBoardView}
                tomorrowJobs={derived.tomorrowJobs}
                tomorrowPlanningDate={derived.tomorrowPlanningDate}
              />
            )}
          </div>
        ) : null}

        {canManageBusiness && activeSection === "customers" ? (
          <CustomerManager
            customers={data.customers}
            jobs={data.jobs}
            onOpenProfile={handleOpenCustomerProfile}
            onCreateCustomer={openCreateCustomer}
            formatDate={formatDate}
            toTimestamp={toTimestamp}
          />
        ) : null}

        {canManageBusiness && activeSection === "job-history" ? (
          <JobHistoryManager
            jobs={data.jobs}
            onOpenJob={handleOpenJob}
            formatDate={formatDate}
            getInvoiceStatus={getInvoiceStatus}
            toTimestamp={toTimestamp}
          />
        ) : null}

        {canManageBusiness && activeSection === "sites" ? (
          <SiteManager
            customers={data.customers}
            jobs={data.jobs}
            onOpenSite={handleOpenSiteProfile}
            onCreateSite={handleCreateSiteProfile}
            buildCustomerSites={buildCustomerSites}
            formatDate={formatDate}
            getSiteDisplayName={getSiteDisplayName}
            toTimestamp={toTimestamp}
          />
        ) : null}

        {canManageBusiness && activeSection === "map" ? (
          <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground" role="status">Loading map...</div>}>
            <GoogleJobsMap customers={data.customers} jobs={data.jobs} dark={themePalette.dark} onOpenJob={handleOpenJob} onOpenSite={handleOpenSiteProfile} />
          </Suspense>
        ) : null}

        {canManageBusiness && activeSection === "calendar" ? (
          <CalendarManager
            jobs={data.jobs}
            onLoadMaintenanceOccurrences={actions.handleLoadMaintenanceOccurrences}
            onRescheduleMaintenance={actions.handleRescheduleMaintenance}
            onGenerateMaintenanceJob={handleGenerateMaintenanceJob}
            onOpenPlan={actions.handleOpenMaintenancePlan}
            onOpenJob={handleOpenJob}
            onScheduleJob={handleScheduleJob}
            onPreviewDayReschedule={handlePreviewDayReschedule}
            onRescheduleDayJobs={handleRescheduleDayJobs}
            onUndoCalendarChange={actions.handleUndoCalendarChange}
            addMonths={addMonths}
            getCalendarDays={getCalendarDays}
            parseDateInputValue={parseDateInputValue}
            toDateInputValue={toDateInputValue}
          />
        ) : null}

        {canManageBusiness && activeSection === "invoices" ? (
          <InvoiceManager
            notice={chrome.invoiceNotice ? <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-status-success-border bg-status-success-surface px-4 py-3 text-sm text-status-success">
            <span>{chrome.invoiceNotice}</span><Button variant="ghost" size="sm" onClick={chrome.dismissInvoiceNotice}>Dismiss</Button>
          </div> : null}
            key={chrome.invoiceCustomerId || "all-customers"}
            customerId={chrome.invoiceCustomerId}
            customerName={data.customers.find((customer) => customer.id === chrome.invoiceCustomerId)?.name}
            onClearCustomer={chrome.clearInvoiceCustomer}
            customers={data.customers}
            jobs={data.jobs.filter((job) => job.invoice || !(data.deletedInvoices || []).some((record) => record.jobId === job.id))}
            onOpenJob={handleOpenJob}
            onOpenCustomerProfile={handleOpenCustomerProfile}
            onOpenInvoice={(job) => handleOpenDoc(job, "invoice")}
            onOpenSentInvoice={(job) => handleOpenSentDocumentCopy(job, "invoice")}
            onUpdateInvoicePayment={handleUpdateInvoicePayment}
            formatDate={formatDate}
            getInvoicePaymentSummary={getInvoicePaymentSummary}
            getInvoiceStatus={getInvoiceStatus}
            normalizeDocument={normalizeDocument}
            toTimestamp={toTimestamp}
          />
        ) : null}

        {canManageBusiness && activeSection === "maintenance" ? (
          <MaintenanceManager
            onOpenPlan={actions.handleOpenMaintenancePlan}
            maintenancePlans={data.maintenancePlans || []}
            customers={data.customers}
            jobs={data.jobs}
          />
        ) : null}

        {canManageBusiness && activeSection === "staff" ? (
          <StaffManager
            fetchWithAuth={auth.fetchWithAuth}
            onPhotoSaved={actions.handleStaffPhotoSaved}
            staff={data.staff}
            onCreateStaff={handleCreateStaff}
            onUpdateStaff={handleUpdateStaff}
            canManageLogins={isAdmin}
            loginAccounts={auth.adminUserAccounts}
            loginAccountsError={auth.adminUserAccountsError}
            onSaveLoginAccount={handleSaveStaffLoginAccount}
          />
        ) : null}

        {canManageBusiness && activeSection === "inventory" ? (
          <InventoryManager
            inventoryItems={data.inventoryItems}
            onCreatePart={handleCreateInventoryItem}
            onUpdatePart={handleUpdateInventoryItem}
            onDeletePart={handleDeleteInventoryItem}
          />
        ) : null}

        {canManageBusiness && activeSection === "statistics" && !workspacePage ? (
          <Suspense fallback={<p className="p-3">Loading reports…</p>}><ReportsAnalytics data={data} fetchWithAuth={auth.fetchWithAuth} /></Suspense>
        ) : null}

        {isAuthenticated && activeSection === "settings" ? (
          <SettingsManager
            settingsPersistence={settingsPersistence}
            onSettingsPreview={onSettingsPreview}
            fetchWithAuth={auth.fetchWithAuth}
            workspaceAddons={workspaceAddons}
            canManageWorkspaceSettings={canManageBusiness}
            activeSettingsTab={activeSettingsTab}
            onActiveSettingsTabChange={setActiveSettingsTab}
            settings={{ ...data.settings, ...personalPreferences.preferences }}
            onWorkspaceBrandingChange={actions.handleWorkspaceBrandingChange}
            activeTemplateType={activeTemplateType}
            onActiveTemplateTypeChange={setActiveTemplateType}
            templates={{
              quote: data.quoteTemplate,
              invoice: data.invoiceTemplate,
            }}
            isAuthenticated={isAuthenticated}
            isAdmin={isAdmin}
            onDownloadBackup={auth.handleDownloadBackup}
            onRestoreBackup={auth.handleRestoreBackup}
            onPreviewServiceM8Import={auth.handlePreviewServiceM8Import}
            onApplyServiceM8Import={auth.handleApplyServiceM8Import}
            backupSummary={{
              staff: data.staff.length,
              customers: data.customers.length,
              inventoryItems: data.inventoryItems.length,
              maintenancePlans: data.maintenancePlans.length,
              jobs: data.jobs.length,
              deletedJobs: data.deletedJobs.length,
              deletedCustomers: data.deletedCustomers.length,
              userAccounts: auth.adminUserAccounts.length,
            }}
          />
        ) : null}

        {canManageBusiness && activeSection === "recycle-bin" ? (
          <RecycleBinPanel
            deletedJobs={data.deletedJobs}
            deletedCustomers={data.deletedCustomers}
            deletedInvoices={data.deletedInvoices || []}
            onRestoreInvoice={actions.handleRestoreDeletedInvoice}
            onRestoreJob={handleRestoreDeletedJob}
            onRestoreCustomer={handleRestoreDeletedCustomer}
            onEmptyDeletedJobs={handleEmptyDeletedJobs}
            onEmptyDeletedCustomers={handleEmptyDeletedCustomers}
            formatDate={formatDate}
            getRecycleBinExpiryDate={getRecycleBinExpiryDate}
            toTimestamp={toTimestamp}
          />
        ) : null}
        </div>
      </div>
    </div>
  );
}
