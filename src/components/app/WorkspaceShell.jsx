import { useState } from "react";
import { ChevronRight, LogOut, Maximize2, Minimize2, Plus } from "lucide-react";
import CalendarManager from "@/components/calendar/CalendarManager";
import CustomerManager from "@/components/customers/CustomerManager";
import InventoryManager from "@/components/inventory/InventoryManager";
import InvoiceManager from "@/components/invoices/InvoiceManager";
import JobHistoryManager from "@/components/jobs/JobHistoryManager";
import MaintenanceManager from "@/components/maintenance/MaintenanceManager";
import JobsMapManager from "@/components/map/JobsMapManager";
import RecycleBinPanel from "@/components/recycle-bin/RecycleBinPanel";
import { OfficeBoard, ServiceBoardTagLegend, ServiceBoardTomorrowPanel } from "@/components/service-board/OfficeBoard";
import SettingsManager from "@/components/settings/SettingsManager";
import StaffManager from "@/components/staff/StaffManager";
import SiteManager from "@/components/sites/SiteManager";
import StatisticsPanel from "@/components/statistics/StatisticsPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  LOGO_SRC,
  addMonths,
  buildCustomerSites,
  findSupplierManualMatches,
  formatDate,
  getCalendarDays,
  getCustomerSiteAccessNote,
  getInventoryStockStatus,
  getInvoicePaymentSummary,
  getInvoiceStatus,
  getRecycleBinExpiryDate,
  getSiteDisplayName,
  hexToRgba,
  normalizeDocument,
  normalizeInventoryRecord,
  parseDateInputValue,
  settingsTabs,
  toDateInputValue,
  toTimestamp,
} from "@/lib/app-support";

const FAVICON_SRC = "/favicon.png";

export default function WorkspaceShell({ auth, chrome, data, derived, supplierManualState, actions }) {
  const [serviceBoardHiddenColumns, setServiceBoardHiddenColumns] = useState([]);
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
    setCustomerCreateOpen,
    setJobFormOpen,
    setOfficeSearch,
    setServiceBoardColumnSorts,
    setServiceBoardColumnViews,
    setServiceBoardFullScreen,
    setServiceBoardTomorrowPanelOpen,
    setShowHighUrgencyOnly,
    setShowServiceBoardTagLabels,
    showHighUrgencyOnly,
    showServiceBoardTagLabels,
  } = chrome;
  const {
    dashboard,
    filteredJobs,
    isServiceBoardFullScreen,
    themePalette,
    themeSettings,
    visibleSideNavItems,
  } = derived;
  const {
    handleApplyThemePreset,
    handleCreateInventoryItem,
    handleCreateMaintenancePlan,
    handleCreateStaff,
    handleCreateSiteProfile,
    handleDeleteInventoryItem,
    handleDeleteMaintenancePlan,
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
    handleResetDocumentTemplate,
    handleResetPreferences,
    handleResetUiSettings,
    handleRestoreDeletedCustomer,
    handleRestoreDeletedJob,
    handleSaveStaffLoginAccount,
    handleScheduleJob,
    handleStatusChange,
    handleThemeSettingChange,
    handleUpdateDocumentTemplate,
    handleUpdateInventoryItem,
    handleUpdateInvoicePayment,
    handleUpdateMaintenancePlan,
    handleUpdateStaff,
  } = actions;
  const roleMenuLabel = isTechnician ? "Technician" : isAdmin ? "Admin" : "Office";
  const roleDescription = isTechnician
    ? "Access field jobs, open job details, and keep progress updated."
    : isAdmin
      ? "Manage the full workspace, staff login access, templates, and shared operational data."
      : "Coordinate day-to-day jobs, customers, invoicing, and scheduling across the business.";
  const isIconOnlySidebar = themeSettings.sidebarWidth === "icon-only";

  const handleHideServiceBoardColumn = (status) => {
    setServiceBoardHiddenColumns((currentStatuses) => (
      currentStatuses.includes(status) ? currentStatuses : [...currentStatuses, status]
    ));
  };

  const handleShowAllServiceBoardColumns = () => {
    setServiceBoardHiddenColumns([]);
  };

  const renderServiceBoardControls = (tone = "panel") => {
    const isHeroTone = tone === "hero";
    const searchInputClassName = isHeroTone
      ? "border-white/70 bg-white/95 text-slate-900 placeholder:text-slate-500 shadow-sm sm:w-[320px] xl:w-[420px]"
      : "sm:w-[320px]";
    const urgencyContainerClassName = isHeroTone
      ? "flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-white"
      : "flex items-center gap-3 rounded-2xl border bg-white px-4 py-2";
    const fullScreenButtonClassName = isHeroTone
      ? "rounded-2xl border-white/30 bg-white/95 text-slate-900 hover:bg-white"
      : "rounded-2xl bg-white";

    return (
      <div className="grid gap-3">
        <div className="flex w-full flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <Input
            className={searchInputClassName}
            placeholder="Search jobs, customer, address..."
            value={officeSearch}
            onChange={(event) => setOfficeSearch(event.target.value)}
          />

          <div className="flex flex-wrap items-center gap-3 xl:justify-end">
            <div className={urgencyContainerClassName}>
              <Checkbox checked={showHighUrgencyOnly} onCheckedChange={(checked) => setShowHighUrgencyOnly(Boolean(checked))} />
              <span className="text-sm">High urgency only</span>
            </div>
            <Button
              variant="outline"
              className={fullScreenButtonClassName}
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
            </Button>
            {canManageBusiness ? (
              <Button className="rounded-2xl hover:opacity-95" style={themePalette.primaryButton} onClick={() => setJobFormOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> New Job
              </Button>
            ) : null}
          </div>
        </div>

        <ServiceBoardTagLegend
          tone={isHeroTone ? "hero" : "default"}
          showTagLabels={showServiceBoardTagLabels}
          onToggleShowTagLabels={setShowServiceBoardTagLabels}
          hiddenColumnCount={serviceBoardHiddenColumns.length}
          onShowHiddenColumns={handleShowAllServiceBoardColumns}
        />
      </div>
    );
  };

  return (
    <>
      {!isServiceBoardFullScreen && (
        <aside className={isIconOnlySidebar ? "mx-auto w-[var(--sidebar-width)] lg:fixed lg:inset-y-0 lg:left-0 lg:mx-0" : "lg:fixed lg:inset-y-0 lg:left-0 lg:w-[var(--sidebar-width)]"}>
          <div
            className="overflow-hidden border shadow-sm backdrop-blur lg:flex lg:h-screen lg:flex-col lg:rounded-none lg:border-y-0 lg:border-r lg:border-l-0"
            style={themePalette.sidebarShell}
          >
            <div className={isIconOnlySidebar ? "p-2 lg:flex-1 lg:overflow-y-auto" : "p-4 lg:flex-1 lg:overflow-y-auto lg:p-5"}>
              <div
                className={isIconOnlySidebar ? "mx-auto flex h-12 w-12 justify-center overflow-hidden rounded-2xl border p-0 shadow-sm" : "overflow-hidden rounded-3xl border p-4 shadow-sm"}
                style={{
                  ...themePalette.sidebarHeader,
                  borderColor: themePalette.borderColor,
                }}
              >
                {isIconOnlySidebar ? (
                  <div className="flex h-full w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/5 bg-white p-2 shadow-sm" title="Elset Admin">
                    <img src={FAVICON_SRC} alt="Elset Admin" className="block h-full w-full object-contain" />
                  </div>
                ) : (
                  <>
                    <div className="mx-auto grid max-w-full grid-cols-[104px_72px] items-center justify-center gap-2.5">
                      <div className="flex h-14 w-[104px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/5 bg-white px-1 shadow-sm">
                        <img src={LOGO_SRC} alt="Elset logo" className="block h-auto w-[138%] max-w-none" />
                      </div>
                      <div className="min-w-0 self-center text-left font-semibold uppercase leading-none tracking-[0.04em]">
                        <span className="block text-[0.7rem]">{roleMenuLabel}</span>
                        <span className="mt-1 block text-sm">Menu</span>
                      </div>
                    </div>
                    <p className="mt-4 text-sm leading-6" style={{ color: themePalette.sidebarHeaderMuted }}>
                      {roleDescription}
                    </p>
                  </>
                )}
              </div>

              <div className={isIconOnlySidebar ? "mt-4 grid justify-center gap-2" : "mt-4 grid gap-2"}>
                {visibleSideNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.id;
                  const isSettingsItem = item.id === "settings";

                  return (
                    <div key={item.id} className={isIconOnlySidebar ? "grid justify-center" : "space-y-2"}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveSection(item.id);
                          if (isSettingsItem && !activeSettingsTab) {
                            setActiveSettingsTab("preferences");
                          }
                        }}
                        className={
                          isIconOnlySidebar
                            ? "flex h-12 w-12 items-center justify-center rounded-2xl border p-0 text-left transition hover:translate-x-[1px] hover:shadow-sm"
                            : "flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition hover:translate-x-[1px] hover:shadow-sm"
                        }
                        style={isActive ? themePalette.sidebarActiveButton : themePalette.sidebarInactiveButton}
                        title={item.label}
                        aria-label={item.label}
                      >
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                          style={isActive ? themePalette.sidebarActiveIcon : themePalette.sidebarInactiveIcon}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        {isIconOnlySidebar ? (
                          <span className="sr-only">{item.label}</span>
                        ) : (
                          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 self-center">
                            <p className="font-semibold">{item.label}</p>
                            {isSettingsItem ? (
                              <ChevronRight className={`h-4 w-4 transition-transform ${isActive ? "rotate-90" : ""}`} />
                            ) : null}
                          </div>
                        )}
                      </button>

                      {isSettingsItem && isActive && !isIconOnlySidebar ? (
                        <div className="grid gap-1 pl-14 animate-in slide-in-from-top-1 fade-in-0 duration-200">
                          {settingsTabs.map((tab) => {
                            const isSettingsTabActive = activeSettingsTab === tab.value;

                            return (
                              <button
                                key={tab.value}
                                type="button"
                                onClick={() => {
                                  setActiveSection("settings");
                                  setActiveSettingsTab(tab.value);
                                }}
                                className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition hover:translate-x-[1px]"
                                style={
                                  isSettingsTabActive
                                    ? { ...themePalette.sidebarActiveButton, boxShadow: "none" }
                                    : { ...themePalette.sidebarInactiveButton, boxShadow: "none" }
                                }
                              >
                                <span
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{
                                    backgroundColor: isSettingsTabActive
                                      ? hexToRgba(themePalette.sidebarActiveButton.color, 0.9)
                                      : hexToRgba(themePalette.sidebarInactiveButton.color, 0.52),
                                  }}
                                />
                                <span className="font-medium">{tab.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className={isIconOnlySidebar ? "mt-4 grid justify-center border-t pt-4" : "mt-6 border-t pt-4"} style={{ borderColor: themePalette.borderColor }}>
                <div className={isIconOnlySidebar ? "h-12 w-12 rounded-2xl border p-1 text-sm" : "rounded-2xl border p-4 text-sm"} style={themePalette.sidebarInactiveButton}>
                  {isIconOnlySidebar ? (
                    isAuthenticated ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-full w-full rounded-xl bg-white/80 p-0"
                        onClick={handleLogout}
                        title="Sign Out"
                        aria-label="Sign Out"
                      >
                        <LogOut className="h-4 w-4" />
                      </Button>
                    ) : null
                  ) : (
                    <>
                      <p className="font-semibold">{authUser?.name || "Signed in"}</p>
                      <p className="mt-1 capitalize" style={{ color: themePalette.sidebarInactiveMuted }}>
                        {authUser?.role || "staff"}
                      </p>
                      {authUser?.username ? (
                        <p className="mt-1 text-xs uppercase tracking-[0.14em]" style={{ color: themePalette.sidebarInactiveMuted }}>
                          {authUser.username}
                        </p>
                      ) : null}
                      {isAuthenticated ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-4 w-full rounded-xl bg-white/80"
                          onClick={handleLogout}
                        >
                          <LogOut className="mr-2 h-4 w-4" /> Sign Out
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </aside>
      )}

      <div
        className={
          isServiceBoardFullScreen
            ? "min-w-0 space-y-4 px-3 py-3 sm:px-4 sm:py-4"
            : "min-w-0 space-y-[var(--section-gap)] px-[var(--content-padding-x-mobile)] py-[var(--content-padding-y-mobile)] sm:px-[var(--content-padding-x-sm)] sm:py-[var(--content-padding-y-sm)] lg:px-[var(--content-padding-x-lg)] lg:py-[var(--content-padding-y-lg)] lg:pl-[var(--sidebar-offset)]"
        }
      >
        {authError ? (
          <Card className="rounded-3xl border-amber-200 bg-amber-50">
            <CardContent className="p-4 text-sm text-amber-950">
              {authError}
            </CardContent>
          </Card>
        ) : null}

        {!isServiceBoardFullScreen && activeSection === "service-board" ? (
          <Card className="overflow-hidden rounded-3xl shadow-xl" style={themePalette.heroCard}>
            <CardContent className="p-4 md:px-5 md:py-5">
              {renderServiceBoardControls("hero")}
            </CardContent>
          </Card>
        ) : null}

        {activeSection === "service-board" ? (
          <div className="space-y-6">
            {isServiceBoardFullScreen ? (
              <Card className="sticky top-3 z-20 rounded-3xl border-slate-200 bg-white/80 shadow-sm backdrop-blur">
                <CardContent className="grid gap-3 p-3 md:p-4">
                  {renderServiceBoardControls("panel")}
                </CardContent>
              </Card>
            ) : null}

            <ServiceBoardTomorrowPanel
              jobs={derived.tomorrowJobs}
              open={serviceBoardTomorrowPanelOpen}
              tomorrowDate={derived.tomorrowPlanningDate}
              onOpenChange={setServiceBoardTomorrowPanelOpen}
              onOpenJob={handleOpenJob}
              onRemoveAllJobs={handleRemoveAllJobsFromTomorrow}
              onRemoveJob={handleRemoveJobFromTomorrow}
              formatDate={formatDate}
            />

            <OfficeBoard
              jobs={filteredJobs}
              customers={data.customers}
              onDropJob={handleStatusChange}
              onOpenJob={handleOpenJob}
              onQuickStatusChange={handleStatusChange}
              supplierManuals={supplierManualState.manuals}
              allowDragging
              columnSortModes={serviceBoardColumnSorts}
              columnViewModes={serviceBoardColumnViews}
              onPlanJobForTomorrow={handlePlanJobForTomorrow}
              showTagLabels={showServiceBoardTagLabels}
              findSupplierManualMatches={findSupplierManualMatches}
              getCustomerSiteAccessNote={getCustomerSiteAccessNote}
              getInvoiceStatus={getInvoiceStatus}
              formatDate={formatDate}
              tomorrowPlanningDate={derived.tomorrowPlanningDate}
              hiddenColumnStatuses={serviceBoardHiddenColumns}
              onHideColumn={handleHideServiceBoardColumn}
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
          </div>
        ) : null}

        {canManageBusiness && activeSection === "customers" ? (
          <CustomerManager
            customers={data.customers}
            jobs={data.jobs}
            onOpenProfile={handleOpenCustomerProfile}
            onCreateCustomer={() => setCustomerCreateOpen(true)}
            formatDate={formatDate}
            toTimestamp={toTimestamp}
          />
        ) : null}

        {canManageBusiness && activeSection === "job-history" ? (
          <JobHistoryManager
            jobs={data.jobs}
            staff={data.staff}
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
          <JobsMapManager
            customers={data.customers}
            jobs={data.jobs}
            onOpenJob={handleOpenJob}
          />
        ) : null}

        {canManageBusiness && activeSection === "calendar" ? (
          <CalendarManager
            jobs={data.jobs}
            onOpenJob={handleOpenJob}
            onScheduleJob={handleScheduleJob}
            addMonths={addMonths}
            getCalendarDays={getCalendarDays}
            parseDateInputValue={parseDateInputValue}
            toDateInputValue={toDateInputValue}
          />
        ) : null}

        {canManageBusiness && activeSection === "invoices" ? (
          <InvoiceManager
            jobs={data.jobs}
            onOpenJob={handleOpenJob}
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
            maintenancePlans={data.maintenancePlans || []}
            customers={data.customers}
            staff={data.staff}
            jobs={data.jobs}
            onCreatePlan={handleCreateMaintenancePlan}
            onUpdatePlan={handleUpdateMaintenancePlan}
            onDeletePlan={handleDeleteMaintenancePlan}
            onGenerateJob={handleGenerateMaintenanceJob}
            onOpenJob={handleOpenJob}
          />
        ) : null}

        {canManageBusiness && activeSection === "staff" ? (
          <StaffManager
            staff={data.staff}
            jobs={data.jobs}
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

        {canManageBusiness && activeSection === "statistics" ? (
          <StatisticsPanel
            dashboard={dashboard}
            jobs={data.jobs}
            customers={data.customers}
            staff={data.staff}
            inventoryItems={data.inventoryItems}
            getInventoryStockStatus={getInventoryStockStatus}
            normalizeInventoryRecord={normalizeInventoryRecord}
          />
        ) : null}

        {canManageBusiness && activeSection === "settings" ? (
          <SettingsManager
            activeSettingsTab={activeSettingsTab}
            onActiveSettingsTabChange={setActiveSettingsTab}
            settings={themeSettings}
            onSettingChange={handleThemeSettingChange}
            onApplyPreset={handleApplyThemePreset}
            onResetUiSettings={handleResetUiSettings}
            onResetPreferences={handleResetPreferences}
            activeTemplateType={activeTemplateType}
            onActiveTemplateTypeChange={setActiveTemplateType}
            templates={{
              quote: data.quoteTemplate,
              invoice: data.invoiceTemplate,
            }}
            onTemplateChange={handleUpdateDocumentTemplate}
            onResetTemplate={handleResetDocumentTemplate}
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
    </>
  );
}
