import { Outlet, ScrollRestoration, useLocation, useMatches, useNavigate, useParams, useSearchParams } from "react-router";
import { UnsavedChangesContext } from "@/components/workspace/unsaved-changes-context";
import { recordLinkState } from "@/lib/record-link-state";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import WorkspaceShell from "@/components/app/WorkspaceShell";
import { AuthLoadingScreen } from "@/components/auth/AuthLoadingScreen";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { useAppSession } from "@/hooks/useAppSession";
import { useWorkspaceAddons } from "@/hooks/useWorkspaceAddons";
import { useThemePalette } from "@/hooks/useThemePalette";
import { useSettingsPersistence } from "@/hooks/useSettingsPersistence";
import { UserUiPreferencesContext, useUserUiPreferences } from "@/hooks/useUserUiPreferences";
import { boardPreferenceKeys } from "@/lib/user-ui-preferences";
import { useWorkspaceActions } from "@/hooks/useWorkspaceActions";
import { useWorkspaceViewModel } from "@/hooks/useWorkspaceViewModel";
import { LOGO_SRC, getInitialState } from "@/lib/app-support";
import { statuses } from "@/lib/job-status";

export default function App() {
  const [data, setData] = useState(getInitialState);
  const [isSendingDocument, setIsSendingDocument] = useState(false);
  const [invoiceNotice, setInvoiceNotice] = useState("");
  const [activeTemplateType, setActiveTemplateType] = useState("quote");
  const [settingsPreview, setSettingsPreview] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const match = useMatches().at(-1);
  const { jobId } = useParams();
  const [searchParams] = useSearchParams();
  const { requestAction } = useContext(UnsavedChangesContext);
  const workspacePageOpen = Boolean(match.handle?.record);
  const activeSection = workspacePageOpen ? location.state?.sourceSection || match.handle?.section || "service-board"
    : match.handle?.section || location.state?.section || "service-board";
  const [activeSettingsTab, setActiveSettingsTab] = useState(() => location.pathname === "/settings" && ["xero", "quickbooks"].includes(searchParams.get("accounting")) ? "addons" : "preferences");
  const [officeSearch, setOfficeSearch] = useState("");
  const [billingTypeFilter, setBillingTypeFilter] = useState("all");
  const [showHighUrgencyOnly, setShowHighUrgencyOnly] = useState(false);
  const [serviceBoardFullScreen, setServiceBoardFullScreen] = useState(false);
  const [serviceBoardTomorrowPanelOpen, setServiceBoardTomorrowPanelOpen] = useState(false);
  const resetWorkspaceChromeRef = useRef(() => {});

  const session = useAppSession({
    data,
    onResetWorkspaceChromeRef: resetWorkspaceChromeRef,
    setData,
  });
  const resetWorkspaceChrome = useCallback(() => {
    setIsSendingDocument(false);
    setInvoiceNotice("");
    setActiveTemplateType("quote");
    setActiveSettingsTab("preferences");
    setOfficeSearch("");
    setBillingTypeFilter("all");
    setShowHighUrgencyOnly(false);
    setServiceBoardFullScreen(false);
    setServiceBoardTomorrowPanelOpen(false);
    navigate("/", { replace: true });
  }, [navigate]);

  useEffect(() => {
    resetWorkspaceChromeRef.current = resetWorkspaceChrome;
  }, [resetWorkspaceChrome]);

  const handleActiveSectionChange = (section) => {
    const path = ["customers", "sites", "maintenance", "map", "invoices", "settings", "statistics"].includes(section) ? `/${section}` : "/";
    navigate(path, { state: { section } });
  };
  useEffect(() => {
    if (activeSection !== "invoices") setInvoiceNotice("");
    if (activeSection !== "service-board") {
      setServiceBoardFullScreen(false);
      setServiceBoardTomorrowPanelOpen(false);
    }
  }, [activeSection]);
  const effectiveActiveSection = session.isTechnician && activeSection !== "settings" ? "service-board" : activeSection;
  const effectiveActiveSettingsTab = session.isTechnician ? "ui" : activeSettingsTab;
  const recordRoute = Boolean(jobId);
  const routeSelectedJob = recordRoute ? data.jobs.find((job) => job.id === jobId) || null : null;

  const personalPreferences = useUserUiPreferences({
    fetchWithAuth: session.fetchWithAuth,
    sessionKey: session.isAuthenticated ? session.authUser.id : "",
    legacySettings: data.settings,
  });
  const workspaceAddons = useWorkspaceAddons({
    fetchWithAuth: session.fetchWithAuth,
    sessionKey: session.isAuthenticated ? session.authUser.id : "",
    refreshKey: `${match.id}:${jobId || ""}:${effectiveActiveSection}:${effectiveActiveSettingsTab}`,
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

  const settingsPersistence = useSettingsPersistence({ session, personal: personalPreferences, setData });
  const { themeSettings, themePalette } = useThemePalette({ ...data.settings, ...personalPreferences.preferences, ...settingsPreview });
  const workspaceViewModel = useWorkspaceViewModel({
    activeSection: effectiveActiveSection,
    activeSettingsTab: effectiveActiveSettingsTab,
    authUser: session.authUser,
    data,
    isTechnician: session.isTechnician,
    officeSearch,
    selectedJob: routeSelectedJob,
    serviceBoardFullScreen,
    showHighUrgencyOnly,
    billingTypeFilter,
  });
  const workspaceActions = useWorkspaceActions({
    applyServerWorkspaceState: session.applyServerWorkspaceState,
    canManageBusiness: session.canManageBusiness,
    data,
    docType: match.handle?.documentType || "quote",
    fetchWithAuth: session.fetchWithAuth,
    selectedFreshJob: workspaceViewModel.selectedFreshJob,
    setData,
    setIsSendingDocument,
    themeSettings,
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


  return (
    <UserUiPreferencesContext.Provider value={personalPreferences}>
    <div className="min-h-[100dvh]" style={themePalette.rootStyle}>
      <WorkspaceShell
        auth={{ ...session, handleLogout: () => requestAction(session.handleLogout) }}
        chrome={{
          activeSection: effectiveActiveSection,
          activeSettingsTab: effectiveActiveSettingsTab,
          activeTemplateType,
          invoiceNotice,
          invoiceCustomerId: activeSection === "invoices" ? searchParams.get("customerId") || "" : "",
          clearInvoiceCustomer: () => navigate("/invoices"),
          dismissInvoiceNotice: () => setInvoiceNotice(""),
          officeSearch,
          serviceBoardColumnSorts,
          serviceBoardColumnViews,
          serviceBoardFullScreen,
          serviceBoardTomorrowPanelOpen,
          setActiveSection: handleActiveSectionChange,
          setActiveSettingsTab: (tab) => requestAction(() => setActiveSettingsTab(tab)),
          setActiveTemplateType,
          openCreateCustomer: () => navigate("/customers/new", { state: recordLinkState(location, match, data.jobs) }),
          openCreateJob: () => navigate("/jobs/new", { state: recordLinkState(location, match, data.jobs) }),
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
        workspacePageId={workspacePageOpen ? match.id : ""}
        workspacePage={workspacePageOpen ? <Outlet context={{
          session, data, setData, workspaceActions, workspaceViewModel, workspaceAddons,
          setInvoiceNotice, isSendingDocument,
        }} /> : null}
        personalPreferences={personalPreferences}
        workspaceAddons={workspaceAddons}
        settingsPersistence={settingsPersistence}
        onSettingsPreview={setSettingsPreview}
      />

      <ScrollRestoration />
    </div>
    </UserUiPreferencesContext.Provider>
  );
}
