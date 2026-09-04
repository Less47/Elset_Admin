import { useState } from "react";
import { ChevronRight, LogOut, Maximize2, Minimize2, Plus } from "lucide-react";
import MobileWorkspaceNavigation from "@/components/app/MobileWorkspaceNavigation";
import CalendarManager from "@/components/calendar/CalendarManager";
import CustomerManager from "@/components/customers/CustomerManager";
import InventoryManager from "@/components/inventory/InventoryManager";
import InvoiceManager from "@/components/invoices/InvoiceManager";
import JobHistoryManager from "@/components/jobs/JobHistoryManager";
import MaintenanceManager from "@/components/maintenance/MaintenanceManager";
import JobsMapManager from "@/components/map/JobsMapManager";
import RecycleBinPanel from "@/components/recycle-bin/RecycleBinPanel";
import MobileServiceBoard from "@/components/service-board/MobileServiceBoard";
import { OfficeBoard, ServiceBoardTagLegend, ServiceBoardTomorrowPanel } from "@/components/service-board/OfficeBoard";
import { TOMORROW_VIEW } from "@/components/service-board/service-board-utils";
import SettingsManager from "@/components/settings/SettingsManager";
import StaffManager from "@/components/staff/StaffManager";
import SiteManager from "@/components/sites/SiteManager";
import StatisticsPanel from "@/components/statistics/StatisticsPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  LOGO_SRC,
  addMonths,
  buildCustomerSites,
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

export default function WorkspaceShell({ auth, chrome, data, derived, actions, workspacePage = null }) {
  const [serviceBoardHiddenColumns, setServiceBoardHiddenColumns] = useState([]);
  const [mobileServiceBoardView, setMobileServiceBoardView] = useState("To Do");
  const isDesktopLayout = useMediaQuery("(min-width: 64rem)");
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
    openCreateJob,
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
    currentSection,
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
  const desktopServiceBoardFullScreen = isDesktopLayout && isServiceBoardFullScreen;

  const handleMobileNavigate = (sectionId) => {
    const navigationStarted = setActiveSection(sectionId);
    if (navigationStarted !== false && sectionId === "service-board") setMobileServiceBoardView("To Do");
    return navigationStarted;
  };

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
      ? "min-w-0 flex-1 border-white/70 bg-white/95 text-slate-900 placeholder:text-slate-500 shadow-sm"
      : "min-w-0 flex-1";
    const urgencyContainerClassName = isHeroTone
      ? "flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-white"
      : "flex items-center gap-2 rounded-2xl border bg-white px-3 py-2";
    const fullScreenButtonClassName = isHeroTone
      ? "rounded-2xl border-white/30 bg-white/95 text-slate-900 hover:bg-white"
      : "rounded-2xl bg-white";

    return (
      <div className="grid gap-3">
        <div className="flex w-full flex-col gap-2 md:flex-row md:items-center">
          <Input
            className={searchInputClassName}
            placeholder="Search jobs, customer, address..."
            value={officeSearch}
            onChange={(event) => setOfficeSearch(event.target.value)}
          />

          <div className="flex shrink-0 flex-nowrap items-center gap-2 md:justify-end">
            <div className={urgencyContainerClassName}>
              <Checkbox checked={showHighUrgencyOnly} onCheckedChange={(checked) => setShowHighUrgencyOnly(Boolean(checked))} />
              <span className="whitespace-nowrap text-sm">High urgency only</span>
            </div>
            <Button
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
            </Button>
            {canManageBusiness ? (
              <Button className="whitespace-nowrap rounded-2xl px-3 hover:opacity-95" style={themePalette.primaryButton} onClick={() => openCreateJob()}>
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
      {!isDesktopLayout && !workspacePage ? (
        <MobileWorkspaceNavigation
          activeSection={activeSection}
          authUser={authUser}
          canManageBusiness={canManageBusiness}
          currentSection={currentSection}
          items={visibleSideNavItems}
          onLogout={handleLogout}
          onNavigate={handleMobileNavigate}
          onNewJob={() => openCreateJob()}
          onOpenTomorrow={() => setMobileServiceBoardView(TOMORROW_VIEW)}
          roleLabel={roleMenuLabel}
          themePalette={themePalette}
          tomorrowCount={derived.tomorrowJobs.length}
          tomorrowSelected={mobileServiceBoardView === TOMORROW_VIEW}
        />
      ) : null}

      {!desktopServiceBoardFullScreen && (
        <aside className={isIconOnlySidebar ? "hidden lg:fixed lg:inset-y-0 lg:left-0 lg:block lg:w-[var(--sidebar-width)]" : "hidden lg:fixed lg:inset-y-0 lg:left-0 lg:block lg:w-[var(--sidebar-width)]"}>
          <div
            className="overflow-hidden border shadow-sm backdrop-blur lg:flex lg:h-screen lg:flex-col lg:rounded-none lg:border-y-0 lg:border-r lg:border-l-0"
            style={themePalette.sidebarShell}
          >
            <div className={isIconOnlySidebar ? "flex items-center gap-2 overflow-x-auto p-2 lg:block lg:flex-1 lg:overflow-y-auto" : "p-4 lg:flex-1 lg:overflow-y-auto lg:p-5"}>
              <div
                className={isIconOnlySidebar ? "flex h-12 w-12 shrink-0 justify-center overflow-hidden rounded-2xl border p-0 shadow-sm lg:mx-auto" : "overflow-hidden rounded-3xl border p-4 shadow-sm"}
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

              <nav
                aria-label="Application"
                className={isIconOnlySidebar ? "flex flex-1 items-center gap-2 overflow-x-auto lg:mt-4 lg:grid lg:justify-center" : "mt-4 grid gap-2"}
              >
                {visibleSideNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.id;
                  const isSettingsItem = item.id === "settings";

                  return (
                    <div key={item.id} className={isIconOnlySidebar ? "shrink-0 lg:grid lg:justify-center" : "space-y-2"}>
                      <button
                        type="button"
                        onClick={() => {
                          const navigationStarted = setActiveSection(item.id);
                          if (navigationStarted !== false && isSettingsItem && !activeSettingsTab) {
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
                        aria-current={isActive ? "page" : undefined}
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
                                  const navigationStarted = setActiveSection("settings");
                                  if (navigationStarted !== false) setActiveSettingsTab(tab.value);
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
              </nav>

              <div className={isIconOnlySidebar ? "ml-2 shrink-0 border-l pl-2 lg:ml-0 lg:mt-4 lg:grid lg:justify-center lg:border-l-0 lg:border-t lg:pl-0 lg:pt-4" : "mt-6 border-t pt-4"} style={{ borderColor: themePalette.borderColor }}>
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
          workspacePage
            ? "min-w-0 lg:pl-[var(--sidebar-offset)] lg:pt-4"
            : desktopServiceBoardFullScreen
            ? "min-w-0 space-y-4 px-3 py-3 sm:px-4 sm:py-4"
            : activeSection === "service-board"
            ? "mobile-safe-workspace min-w-0 space-y-[var(--section-gap)] px-[var(--content-padding-x-mobile)] pb-[var(--content-padding-y-mobile)] pt-0 sm:px-[var(--content-padding-x-sm)] sm:pb-[var(--content-padding-y-sm)] sm:pt-0 lg:px-[var(--content-padding-x-lg)] lg:pb-[var(--content-padding-y-lg)] lg:pl-[var(--sidebar-offset)] lg:pt-[var(--content-padding-y-lg)]"
            : "mobile-safe-workspace min-w-0 space-y-[var(--section-gap)] px-[var(--content-padding-x-mobile)] py-[var(--content-padding-y-mobile)] sm:px-[var(--content-padding-x-sm)] sm:py-[var(--content-padding-y-sm)] lg:px-[var(--content-padding-x-lg)] lg:py-[var(--content-padding-y-lg)] lg:pl-[var(--sidebar-offset)]"
        }
      >
        {workspacePage}

        <div className={workspacePage ? undefined : "contents"} hidden={Boolean(workspacePage)} aria-hidden={workspacePage ? true : undefined}>
        {authError ? (
          <Card className="rounded-3xl border-amber-200 bg-amber-50">
            <CardContent className="p-4 text-sm text-amber-950">
              {authError}
            </CardContent>
          </Card>
        ) : null}

        {activeSection === "service-board" ? (
          <div className="min-w-0">
            {isDesktopLayout ? (
              <>
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

                <div className="grid gap-4" data-desktop-service-board-layout>
                  {desktopServiceBoardFullScreen ? (
                    <Card data-service-board-toolbar className="sticky top-3 z-20 rounded-xl border-slate-200 bg-white/80 shadow-sm backdrop-blur">
                      <CardContent className="grid gap-3 p-3 md:p-4">
                        {renderServiceBoardControls("panel")}
                      </CardContent>
                    </Card>
                  ) : (
                    <Card data-service-board-toolbar className="overflow-hidden rounded-xl shadow-xl" style={themePalette.heroCard}>
                      <CardContent className="flex min-h-[104px] flex-col justify-center p-4 md:px-5 md:py-5">
                        {renderServiceBoardControls("hero")}
                      </CardContent>
                    </Card>
                  )}

                  <OfficeBoard
                    jobs={filteredJobs}
                    customers={data.customers}
                    onDropJob={handleStatusChange}
                    onOpenJob={handleOpenJob}
                    allowDragging
                    columnSortModes={serviceBoardColumnSorts}
                    columnViewModes={serviceBoardColumnViews}
                    onPlanJobForTomorrow={handlePlanJobForTomorrow}
                    showTagLabels={showServiceBoardTagLabels}
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
              </>
            ) : (
              <MobileServiceBoard
                canManageTomorrow={canManageBusiness}
                columnSortModes={serviceBoardColumnSorts}
                customers={data.customers}
                formatDate={formatDate}
                getCustomerSiteAccessNote={getCustomerSiteAccessNote}
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
            onCreateCustomer={() => setCustomerCreateOpen(true)}
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
            workspaceStorageMode={auth.workspaceStorageMode}
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
      </div>
    </>
  );
}
