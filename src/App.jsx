import { useCallback, useEffect, useRef, useState } from "react";
import WorkspaceDialogs from "@/components/app/WorkspaceDialogs";
import WorkspaceShell from "@/components/app/WorkspaceShell";
import { AuthLoadingScreen } from "@/components/auth/AuthLoadingScreen";
import { useAppSession } from "@/hooks/useAppSession";
import { useSupplierManuals } from "@/hooks/useSupplierManuals";
import { useThemePalette } from "@/hooks/useThemePalette";
import { useWorkspaceActions } from "@/hooks/useWorkspaceActions";
import { useWorkspaceViewModel } from "@/hooks/useWorkspaceViewModel";
import { LOGO_SRC, getInitialState } from "@/lib/app-support";
import { statuses } from "@/lib/job-status";

export default function App() {
  const [data, setData] = useState(getInitialState);
  const [jobFormOpen, setJobFormOpen] = useState(false);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [selectedSiteContext, setSelectedSiteContext] = useState(null);
  const [jobDetailsOpen, setJobDetailsOpen] = useState(false);
  const [jobEditOpen, setJobEditOpen] = useState(false);
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
  const [showServiceBoardTagLabels, setShowServiceBoardTagLabels] = useState(false);
  const [serviceBoardColumnViews, setServiceBoardColumnViews] = useState(() =>
    Object.fromEntries(statuses.map((status) => [status, "list"]))
  );
  const [serviceBoardColumnSorts, setServiceBoardColumnSorts] = useState(() =>
    Object.fromEntries(statuses.map((status) => [status, "recent"]))
  );
  const resetWorkspaceChromeRef = useRef(() => {});

  const session = useAppSession({
    data,
    onResetWorkspaceChromeRef: resetWorkspaceChromeRef,
    setData,
  });
  const { supplierManualState, resetSupplierManualState } = useSupplierManuals(session.isAuthenticated);

  const resetWorkspaceChrome = useCallback(() => {
    setJobFormOpen(false);
    setCustomerCreateOpen(false);
    setSelectedJob(null);
    setSelectedCustomerId(null);
    setSelectedSiteContext(null);
    setJobDetailsOpen(false);
    setJobEditOpen(false);
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
    setServiceBoardColumnSorts(Object.fromEntries(statuses.map((status) => [status, "recent"])));
    resetSupplierManualState();
  }, [resetSupplierManualState]);

  useEffect(() => {
    resetWorkspaceChromeRef.current = resetWorkspaceChrome;
  }, [resetWorkspaceChrome]);

  const handleActiveSectionChange = useCallback((nextSection) => {
    setActiveSection(nextSection);
    if (nextSection !== "service-board") {
      setServiceBoardFullScreen(false);
    }
  }, []);

  const effectiveActiveSection = session.isTechnician ? "service-board" : activeSection;
  const effectiveActiveSettingsTab = session.isTechnician ? "preferences" : activeSettingsTab;

  const { themeSettings, themePalette } = useThemePalette(data.settings);
  const workspaceViewModel = useWorkspaceViewModel({
    activeSection: effectiveActiveSection,
    activeSettingsTab: effectiveActiveSettingsTab,
    authUser: session.authUser,
    data,
    isTechnician: session.isTechnician,
    officeSearch,
    selectedCustomerId,
    selectedJob,
    selectedSiteContext,
    serviceBoardFullScreen,
    showHighUrgencyOnly,
    supplierManuals: supplierManualState.manuals,
  });
  const workspaceActions = useWorkspaceActions({
    authToken: session.authToken,
    canManageBusiness: session.canManageBusiness,
    data,
    docType,
    selectedFreshJob: workspaceViewModel.selectedFreshJob,
    selectedJob,
    selectedSiteContext,
    setCustomerProfileOpen,
    setData,
    setDocEditorOpen,
    setDocType,
    setIsSendingDocument,
    setJobDetailsOpen,
    setJobEditOpen,
    setSelectedCustomerId,
    setSelectedJob,
    setSelectedSiteContext,
    setSiteProfileOpen,
    themeSettings,
  });

  if (session.authStatus === "checking") {
    return <AuthLoadingScreen logoSrc={LOGO_SRC} />;
  }

  return (
    <div className="min-h-screen" style={themePalette.rootStyle}>
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
          setActiveSection: handleActiveSectionChange,
          setActiveSettingsTab,
          setActiveTemplateType,
          setCustomerCreateOpen,
          setJobFormOpen,
          setOfficeSearch,
          setServiceBoardColumnSorts,
          setServiceBoardColumnViews,
          setServiceBoardFullScreen,
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
        supplierManualState={supplierManualState}
        actions={{
          ...workspaceActions,
          handleSaveStaffLoginAccount: session.handleSaveStaffLoginAccount,
        }}
      />

      <WorkspaceDialogs
        auth={session}
        chrome={{
          customerCreateOpen,
          customerProfileOpen,
          docEditorOpen,
          docType,
          isSendingDocument,
          jobDetailsOpen,
          jobEditOpen,
          jobFormOpen,
          setCustomerCreateOpen,
          setCustomerProfileOpen,
          setDocEditorOpen,
          setJobDetailsOpen,
          setJobEditOpen,
          setJobFormOpen,
          setSelectedCustomerId,
          setSelectedSiteContext,
          setSiteProfileOpen,
          siteProfileOpen,
        }}
        data={data}
        selection={workspaceViewModel}
        supplierManualState={supplierManualState}
        actions={workspaceActions}
      />
    </div>
  );
}
