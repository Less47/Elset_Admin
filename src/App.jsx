import { useCallback, useEffect, useRef, useState } from "react";
import CustomerPages from "@/components/customers/CustomerPages";
import WorkspaceShell from "@/components/app/WorkspaceShell";
import { AuthLoadingScreen } from "@/components/auth/AuthLoadingScreen";
import { LoginScreen } from "@/components/auth/LoginScreen";
import CreateJobPage from "@/components/jobs/CreateJobPage";
import JobDetailsPage from "@/components/jobs/JobDetailsPage";
import DocumentEditor from "@/components/documents/DocumentEditor";
import { RecordWorkspace, UnsavedChangesDialog, WorkspaceMessage } from "@/components/workspace/RecordWorkspace";
import { useAppSession } from "@/hooks/useAppSession";
import { useThemePalette } from "@/hooks/useThemePalette";
import { useThemeSettingsSave } from "@/hooks/useThemeSettingsSave";
import { UserUiPreferencesContext, useUserUiPreferences } from "@/hooks/useUserUiPreferences";
import { boardPreferenceKeys } from "@/lib/user-ui-preferences";
import { useWorkspaceActions } from "@/hooks/useWorkspaceActions";
import { parseWorkspacePath, useWorkspaceNavigation } from "@/hooks/useWorkspaceNavigation";
import { useWorkspaceViewModel } from "@/hooks/useWorkspaceViewModel";
import { LOGO_SRC, getInitialState, readFileAsDataUrl, sectionMeta, sideNavItems } from "@/lib/app-support";
import { statuses } from "@/lib/job-status";

export default function App() {
  const [data, setData] = useState(getInitialState);
  const [selectedJob, setSelectedJob] = useState(null);
  const [isSendingDocument, setIsSendingDocument] = useState(false);
  const [activeTemplateType, setActiveTemplateType] = useState("quote");
  const [activeSection, setActiveSection] = useState("service-board");
  const [activeSettingsTab, setActiveSettingsTab] = useState("preferences");
  const [officeSearch, setOfficeSearch] = useState("");
  const [showHighUrgencyOnly, setShowHighUrgencyOnly] = useState(false);
  const [serviceBoardFullScreen, setServiceBoardFullScreen] = useState(false);
  const [serviceBoardTomorrowPanelOpen, setServiceBoardTomorrowPanelOpen] = useState(false);
  const resetWorkspaceChromeRef = useRef(() => {});
  const workspaceNavigation = useWorkspaceNavigation({ activeSection, onSectionChange: setActiveSection });
  const { navigateToSection, resetToRoot } = workspaceNavigation;

  const session = useAppSession({
    data,
    onResetWorkspaceChromeRef: resetWorkspaceChromeRef,
    setData,
  });
  const resetWorkspaceChrome = useCallback(() => {
    setSelectedJob(null);
    setIsSendingDocument(false);
    setActiveTemplateType("quote");
    setActiveSection("service-board");
    setActiveSettingsTab("preferences");
    setOfficeSearch("");
    setShowHighUrgencyOnly(false);
    setServiceBoardFullScreen(false);
    setServiceBoardTomorrowPanelOpen(false);
    resetToRoot();
  }, [resetToRoot]);

  useEffect(() => {
    resetWorkspaceChromeRef.current = resetWorkspaceChrome;
  }, [resetWorkspaceChrome]);

  const handleActiveSectionChange = useCallback((nextSection) => {
    return navigateToSection(nextSection, () => {
        if (nextSection !== "service-board") {
          setServiceBoardFullScreen(false);
          setServiceBoardTomorrowPanelOpen(false);
        }
    });
  }, [navigateToSection]);

  const effectiveActiveSection = session.isTechnician && activeSection !== "settings" ? "service-board" : activeSection;
  const effectiveActiveSettingsTab = session.isTechnician ? "ui" : activeSettingsTab;
  const recordRoute = ["job-details", "document"].includes(workspaceNavigation.route.type);
  const routeSelectedJob = recordRoute
    ? data.jobs.find((job) => job.id === workspaceNavigation.route.jobId) || null
    : null;
  const selectedJobForView = recordRoute ? routeSelectedJob : selectedJob;

  const personalPreferences = useUserUiPreferences({
    fetchWithAuth: session.fetchWithAuth,
    sessionKey: session.isAuthenticated ? session.authUser.id : "",
    legacySettings: data.settings,
  });
  const boardValues = (kind, preferences = personalPreferences.preferences) => Object.fromEntries(
    statuses.map((status) => [status, preferences[boardPreferenceKeys[status][kind]]])
  );
  const changeBoardValues = (kind, update) => {
    const previous = boardValues(kind, personalPreferences.getPreferences());
    const next = typeof update === "function" ? update(previous) : update;
    const patch = Object.fromEntries(statuses.filter((status) => next[status] !== previous[status])
      .map((status) => [boardPreferenceKeys[status][kind], next[status]]));
    if (Object.keys(patch).length) personalPreferences.change(patch);
  };
  const serviceBoardColumnViews = boardValues("view");
  const serviceBoardColumnSorts = boardValues("sort");
  const setServiceBoardColumnViews = (update) => changeBoardValues("view", update);
  const setServiceBoardColumnSorts = (update) => changeBoardValues("sort", update);
  const showServiceBoardTagLabels = personalPreferences.preferences.boardShowTagLabels;
  const setShowServiceBoardTagLabels = (value) => personalPreferences.change({ boardShowTagLabels: value });

  const themeSettingsSave = useThemeSettingsSave({
    settings: data.settings,
    fetchWithAuth: session.fetchWithAuth,
    setData,
    sessionKey: session.authUser?.id || "",
    personal: personalPreferences,
  });
  const { themeSettings, themePalette } = useThemePalette(themeSettingsSave.settings);
  const workspaceViewModel = useWorkspaceViewModel({
    activeSection: effectiveActiveSection,
    activeSettingsTab: effectiveActiveSettingsTab,
    authUser: session.authUser,
    data,
    isTechnician: session.isTechnician,
    officeSearch,
    selectedJob: selectedJobForView,
    serviceBoardFullScreen,
    showHighUrgencyOnly,
  });
  const workspaceActions = useWorkspaceActions({
    applyServerWorkspaceState: session.applyServerWorkspaceState,
    canManageBusiness: session.canManageBusiness,
    data,
    docType: workspaceNavigation.route.documentType || "quote",
    fetchWithAuth: session.fetchWithAuth,
    selectedFreshJob: workspaceViewModel.selectedFreshJob,
    selectedJob: selectedJobForView,
    setData,
    onNavigateToDocument: workspaceNavigation.navigateToDocument,
    setIsSendingDocument,
    onNavigateToJob: workspaceNavigation.navigateToJob,
    onNavigateToCustomer: workspaceNavigation.navigateToCustomer,
    onNavigateToSite: workspaceNavigation.navigateToSite,
    setSelectedJob,
    themeSettings,
    themeSettingsSave,
    workspaceStorageMode: session.workspaceStorageMode,
  });

  if (session.authStatus === "checking" || (session.isAuthenticated && personalPreferences.loading)) {
    return <AuthLoadingScreen logoSrc={LOGO_SRC} />;
  }

  if (!session.isAuthenticated) {
    return (
      <LoginScreen
        loginForm={session.loginForm}
        onFieldChange={session.handleLoginFieldChange}
        onSubmit={session.handleLogin}
        error={session.authError}
        isLoading={session.isAuthenticating}
        logoSrc={LOGO_SRC}
      />
    );
  }

  const workspaceRoute = workspaceNavigation.route;
  const workspacePageOpen = workspaceRoute.type !== "section";
  const sourceMeta = sectionMeta[workspaceRoute.sourceSection] || sectionMeta["service-board"];
  const sourceNavigationItem = sideNavItems.find((item) => item.id === workspaceRoute.sourceSection);
  const returnRoute = workspaceRoute.returnPath ? parseWorkspacePath(workspaceRoute.returnPath) : null;
  const customerPageOpen = ["customer-details", "create-customer", "edit-customer", "site-details", "create-site", "edit-site"].includes(workspaceRoute.type);
  const backLabel = returnRoute?.type === "customer-details" || (!returnRoute && ["site-details", "create-site", "edit-customer"].includes(workspaceRoute.type)) ? "Customer Profile"
    : returnRoute?.type === "site-details" ? "Site Profile"
    : returnRoute?.type === "edit-customer" ? "Edit Customer"
    : returnRoute?.type === "job-details" ? "Job #" + (data.jobs.find((job) => job.id === returnRoute.jobId)?.jobNumber || "Details")
    : customerPageOpen && !workspaceRoute.returnPath ? "Customers"
    : sourceNavigationItem?.label || sourceMeta?.title || "Service Board";

  const handleJobPhotoUpload = async (files) => {
    if (!workspaceViewModel.selectedFreshJob) return false;

    try {
      const photos = await Promise.all(
        files.map(async (file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          url: await readFileAsDataUrl(file),
        }))
      );
      return workspaceActions.handleAddJobPhotos(workspaceViewModel.selectedFreshJob.id, photos);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to read the selected image files.");
      return false;
    }
  };

  const workspacePage = customerPageOpen
    ? <CustomerPages route={workspaceRoute} navigation={workspaceNavigation} actions={workspaceActions} data={data} canManageBusiness={session.canManageBusiness} backLabel={backLabel} />
    : workspaceRoute.type === "create-job"
    ? session.canManageBusiness
      ? (
          <CreateJobPage
            backLabel={backLabel}
            customers={data.customers}
            jobs={data.jobs}
            staff={data.staff}
            onCancel={workspaceNavigation.closeWorkspace}
            onCreated={(job) => {
              setSelectedJob(job);
              workspaceNavigation.navigateToJob(job, { replace: true, force: true });
            }}
            onSave={workspaceActions.createJob}
            registerNavigationBlocker={workspaceNavigation.registerBlocker}
          />
        )
      : (
          <RecordWorkspace backLabel={backLabel} eyebrow="Jobs" title="Create Job" onBack={() => workspaceNavigation.closeWorkspace({ force: true })}>
            <WorkspaceMessage tone="error">You do not have permission to create jobs.</WorkspaceMessage>
          </RecordWorkspace>
        )
    : workspaceRoute.type === "job-details"
      ? (
          <JobDetailsPage
            key={workspaceViewModel.selectedFreshJob?.id || `missing-${workspaceRoute.jobId}`}
            backLabel={backLabel}
            canDeleteJob={session.canManageBusiness}
            canEditJob={session.canManageBusiness}
            customer={workspaceViewModel.selectedFreshCustomer}
            customerJobs={workspaceViewModel.selectedFreshCustomerJobs}
            job={workspaceViewModel.selectedFreshJob}
            staff={data.staff}
            showCommercialDocuments={session.canManageBusiness}
            onBack={workspaceNavigation.closeWorkspace}
            onStatusChange={(status) => workspaceViewModel.selectedFreshJob
              ? workspaceActions.handleStatusChange(workspaceViewModel.selectedFreshJob.id, status)
              : false}
            onUpdateJobDetails={(updates) => workspaceViewModel.selectedFreshJob
              ? workspaceActions.handleUpdateJobDetails(workspaceViewModel.selectedFreshJob.id, updates)
              : false}
            onDeleteJob={() => workspaceViewModel.selectedFreshJob
              ? workspaceActions.handleDeleteJob(workspaceViewModel.selectedFreshJob.id)
              : false}
            onDeleted={() => workspaceNavigation.closeWorkspace({ force: true })}
            onOpenCustomerProfile={session.canManageBusiness ? workspaceActions.handleOpenCustomerProfile : null}
            onOpenSiteProfile={session.canManageBusiness ? workspaceActions.handleOpenSiteProfile : null}
            onOpenDocument={session.canManageBusiness ? (type) => {
              if (workspaceViewModel.selectedFreshJob) workspaceActions.handleOpenDoc(workspaceViewModel.selectedFreshJob, type);
            } : null}
            onOpenSentDocument={session.canManageBusiness ? (type) => {
              if (workspaceViewModel.selectedFreshJob) workspaceActions.handleOpenSentDocumentCopy(workspaceViewModel.selectedFreshJob, type);
            } : null}
            onAddNote={(text) => workspaceViewModel.selectedFreshJob
              ? workspaceActions.handleAddJobNote(workspaceViewModel.selectedFreshJob.id, text, workspaceViewModel.noteAuthor)
              : false}
            onAddPhotos={handleJobPhotoUpload}
            onDeletePhoto={(photo) => {
              if (!workspaceViewModel.selectedFreshJob) return false;
              const photoLabel = photo?.name || "this photo";
              if (!window.confirm(`Delete ${photoLabel} from this job? This cannot be undone.`)) return false;
              return workspaceActions.handleDeleteJobPhoto(workspaceViewModel.selectedFreshJob.id, photo);
            }}
            registerNavigationBlocker={workspaceNavigation.registerBlocker}
          />
        )
      : workspaceRoute.type === "document"
        ? session.canManageBusiness && routeSelectedJob
          ? <DocumentEditor
              key={`${workspaceRoute.jobId}-${workspaceRoute.documentType}`}
              job={routeSelectedJob}
              type={workspaceRoute.documentType}
              backLabel={!workspaceRoute.returnPath || workspaceRoute.returnPath.startsWith("/jobs/") ? `Job #${routeSelectedJob.jobNumber}` : backLabel}
              onBack={workspaceNavigation.closeWorkspace}
              registerNavigationBlocker={workspaceNavigation.registerBlocker}
              onSave={(doc) => workspaceActions.handleSaveDocument(routeSelectedJob.id, workspaceRoute.documentType, doc)}
              onPreviewDocument={workspaceActions.handlePreviewDocument}
              onSendDocument={workspaceActions.handleSendDocument}
              onOpenSentDocument={() => workspaceActions.handleOpenSentDocumentCopy(routeSelectedJob, workspaceRoute.documentType)}
              isSendingDocument={isSendingDocument}
            />
          : <RecordWorkspace title={workspaceRoute.documentType === "quote" ? "Quote" : "Invoice"} backLabel={backLabel} onBack={() => workspaceNavigation.closeWorkspace({ force: true })}>
              <WorkspaceMessage tone="error">{session.canManageBusiness ? "This job could not be found." : "You do not have permission to edit this document."}</WorkspaceMessage>
            </RecordWorkspace>
        : null;

  return (
    <UserUiPreferencesContext.Provider value={personalPreferences}>
    <div className="min-h-[100dvh]" style={themePalette.rootStyle}>
      <WorkspaceShell
        auth={{ ...session, handleLogout: () => workspaceNavigation.requestNavigation(session.handleLogout) }}
        chrome={{
          activeSection: effectiveActiveSection,
          activeSettingsTab: effectiveActiveSettingsTab,
          activeTemplateType,
          officeSearch,
          serviceBoardColumnSorts,
          serviceBoardColumnViews,
          serviceBoardFullScreen,
          serviceBoardTomorrowPanelOpen,
          setActiveSection: handleActiveSectionChange,
          setActiveSettingsTab,
          setActiveTemplateType,
          openCreateCustomer: workspaceNavigation.navigateToCreateCustomer,
          openCreateJob: workspaceNavigation.navigateToCreateJob,
          setOfficeSearch,
          setServiceBoardColumnSorts,
          setServiceBoardColumnViews,
          setServiceBoardFullScreen,
          setServiceBoardTomorrowPanelOpen,
          setShowHighUrgencyOnly,
          setShowServiceBoardTagLabels,
          showHighUrgencyOnly,
          showServiceBoardTagLabels,
        }}
        data={data}
        derived={{
          ...workspaceViewModel,
          themePalette,
          themeSettings,
        }}
        actions={{
          ...workspaceActions,
          handleSaveStaffLoginAccount: session.handleSaveStaffLoginAccount,
        }}
        workspacePage={workspacePageOpen ? workspacePage : null}
        personalPreferences={personalPreferences}
      />

      <UnsavedChangesDialog
        open={workspaceNavigation.discardPromptOpen}
        onKeepEditing={workspaceNavigation.keepEditing}
        onDiscard={workspaceNavigation.discardAndContinue}
      />
    </div>
    </UserUiPreferencesContext.Provider>
  );
}
