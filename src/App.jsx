import { useCallback, useEffect, useRef, useState } from "react";
import WorkspaceDialogs from "@/components/app/WorkspaceDialogs";
import WorkspaceShell from "@/components/app/WorkspaceShell";
import { AuthLoadingScreen } from "@/components/auth/AuthLoadingScreen";
import { LoginScreen } from "@/components/auth/LoginScreen";
import CreateJobPage from "@/components/jobs/CreateJobPage";
import JobDetailsPage from "@/components/jobs/JobDetailsPage";
import { RecordWorkspace, UnsavedChangesDialog, WorkspaceMessage } from "@/components/workspace/RecordWorkspace";
import { useAppSession } from "@/hooks/useAppSession";
import { useThemePalette } from "@/hooks/useThemePalette";
import { useWorkspaceActions } from "@/hooks/useWorkspaceActions";
import { useWorkspaceNavigation } from "@/hooks/useWorkspaceNavigation";
import { useWorkspaceViewModel } from "@/hooks/useWorkspaceViewModel";
import { LOGO_SRC, getInitialState, readFileAsDataUrl, sectionMeta, sideNavItems } from "@/lib/app-support";
import { statuses } from "@/lib/job-status";

export default function App() {
  const [data, setData] = useState(getInitialState);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [selectedSiteContext, setSelectedSiteContext] = useState(null);
  const [customerProfileOpen, setCustomerProfileOpen] = useState(false);
  const [siteProfileOpen, setSiteProfileOpen] = useState(false);
  const [docEditorOpen, setDocEditorOpen] = useState(false);
  const [isSendingDocument, setIsSendingDocument] = useState(false);
  const [docType, setDocType] = useState("quote");
  const [activeTemplateType, setActiveTemplateType] = useState("quote");
  const [activeSection, setActiveSection] = useState("service-board");
  const [activeSettingsTab, setActiveSettingsTab] = useState("preferences");
  const [officeSearch, setOfficeSearch] = useState("");
  const [showHighUrgencyOnly, setShowHighUrgencyOnly] = useState(false);
  const [serviceBoardFullScreen, setServiceBoardFullScreen] = useState(false);
  const [serviceBoardTomorrowPanelOpen, setServiceBoardTomorrowPanelOpen] = useState(false);
  const [showServiceBoardTagLabels, setShowServiceBoardTagLabels] = useState(false);
  const [serviceBoardColumnViews, setServiceBoardColumnViews] = useState(() =>
    Object.fromEntries(statuses.map((status) => [status, "list"]))
  );
  const [serviceBoardColumnSorts, setServiceBoardColumnSorts] = useState(() =>
    Object.fromEntries(statuses.map((status) => [status, "recent"]))
  );
  const resetWorkspaceChromeRef = useRef(() => {});
  const workspaceNavigation = useWorkspaceNavigation({ activeSection });
  const { closeWorkspace, resetToRoot } = workspaceNavigation;

  const session = useAppSession({
    data,
    onResetWorkspaceChromeRef: resetWorkspaceChromeRef,
    setData,
  });
  const resetWorkspaceChrome = useCallback(() => {
    setCustomerCreateOpen(false);
    setSelectedJob(null);
    setSelectedCustomerId(null);
    setSelectedSiteContext(null);
    setCustomerProfileOpen(false);
    setSiteProfileOpen(false);
    setDocEditorOpen(false);
    setIsSendingDocument(false);
    setDocType("quote");
    setActiveTemplateType("quote");
    setActiveSection("service-board");
    setActiveSettingsTab("preferences");
    setOfficeSearch("");
    setShowHighUrgencyOnly(false);
    setServiceBoardFullScreen(false);
    setServiceBoardTomorrowPanelOpen(false);
    setServiceBoardColumnSorts(Object.fromEntries(statuses.map((status) => [status, "recent"])));
    resetToRoot();
  }, [resetToRoot]);

  useEffect(() => {
    resetWorkspaceChromeRef.current = resetWorkspaceChrome;
  }, [resetWorkspaceChrome]);

  const handleActiveSectionChange = useCallback((nextSection) => {
    return closeWorkspace({
      onClosed: () => {
        setActiveSection(nextSection);
        if (nextSection !== "service-board") {
          setServiceBoardFullScreen(false);
          setServiceBoardTomorrowPanelOpen(false);
        }
      },
    });
  }, [closeWorkspace]);

  const effectiveActiveSection = session.isTechnician ? "service-board" : activeSection;
  const effectiveActiveSettingsTab = session.isTechnician ? "preferences" : activeSettingsTab;
  const routeSelectedJob = workspaceNavigation.route.type === "job-details"
    ? data.jobs.find((job) => job.id === workspaceNavigation.route.jobId) || null
    : null;
  const selectedJobForView = routeSelectedJob || selectedJob;

  const { themeSettings, themePalette } = useThemePalette(data.settings);
  const workspaceViewModel = useWorkspaceViewModel({
    activeSection: effectiveActiveSection,
    activeSettingsTab: effectiveActiveSettingsTab,
    authUser: session.authUser,
    data,
    isTechnician: session.isTechnician,
    officeSearch,
    selectedCustomerId,
    selectedJob: selectedJobForView,
    selectedSiteContext,
    serviceBoardFullScreen,
    showHighUrgencyOnly,
  });
  const workspaceActions = useWorkspaceActions({
    applyServerWorkspaceState: session.applyServerWorkspaceState,
    canManageBusiness: session.canManageBusiness,
    data,
    docType,
    fetchWithAuth: session.fetchWithAuth,
    onCloseJobWorkspace: workspaceNavigation.closeWorkspace,
    selectedFreshJob: workspaceViewModel.selectedFreshJob,
    selectedJob: selectedJobForView,
    selectedSiteContext,
    setCustomerProfileOpen,
    setData,
    setDocEditorOpen,
    setDocType,
    setIsSendingDocument,
    onNavigateToJob: workspaceNavigation.navigateToJob,
    setSelectedCustomerId,
    setSelectedJob,
    setSelectedSiteContext,
    setSiteProfileOpen,
    themeSettings,
    workspaceStorageMode: session.workspaceStorageMode,
  });

  if (session.authStatus === "checking") {
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
  const backLabel = sourceNavigationItem?.label || sourceMeta?.title || "Service Board";

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

  const workspacePage = workspaceRoute.type === "create-job"
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
      : null;

  return (
    <div className="min-h-[100dvh]" style={themePalette.rootStyle}>
      <WorkspaceShell
        auth={session}
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
          setCustomerCreateOpen,
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
      />

      <WorkspaceDialogs
        auth={session}
        chrome={{
          customerCreateOpen,
          customerProfileOpen,
          docEditorOpen,
          docType,
          isSendingDocument,
          setCustomerCreateOpen,
          setCustomerProfileOpen,
          setDocEditorOpen,
          setSelectedCustomerId,
          setSelectedSiteContext,
          setSiteProfileOpen,
          siteProfileOpen,
        }}
        selection={workspaceViewModel}
        actions={workspaceActions}
      />

      <UnsavedChangesDialog
        open={workspaceNavigation.discardPromptOpen}
        onKeepEditing={workspaceNavigation.keepEditing}
        onDiscard={workspaceNavigation.discardAndContinue}
      />
    </div>
  );
}
