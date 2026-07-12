import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  countBusinessRecords,
  getLegacyPersistedState,
  hasCompletedServerMigration,
  markServerMigrationComplete,
  normalizeAppState,
  purgeExpiredRecycleBinState,
  seedData,
} from "@/lib/app-support";

function buildFallbackBackupFilename() {
  return `elset-admin-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
}

function getDownloadFilename(contentDisposition) {
  const value = String(contentDisposition || "");
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const filenameMatch = value.match(/filename="([^"]+)"/i) || value.match(/filename=([^;]+)/i);
  return filenameMatch?.[1]?.trim() || buildFallbackBackupFilename();
}

async function readServiceM8ImportResponse(response) {
  const contentType = String(response.headers.get("Content-Type") || "").toLowerCase();

  if (!contentType.includes("application/json")) {
    const bodyText = await response.text().catch(() => "");
    const statusLabel = `${response.status} ${response.statusText || ""}`.trim();
    const details = bodyText && !bodyText.trim().startsWith("<")
      ? ` ${bodyText.trim().slice(0, 180)}`
      : "";

    return {
      payload: null,
      error: response.status === 404
        ? "The ServiceM8 import API is not available yet. Restart the backend, then try again."
        : `The ServiceM8 import API returned an unexpected ${statusLabel || "non-JSON"} response.${details}`,
    };
  }

  return {
    payload: await response.json().catch(() => null),
    error: "",
  };
}

function getServiceM8ImportError(response, payload, responseError, fallback) {
  if (payload?.error) return payload.error;
  if (responseError) return responseError;
  if (response.status === 404) {
    return "The ServiceM8 import API is not available yet. Restart the backend, then try again.";
  }
  if (response.ok) {
    return "The ServiceM8 import API returned an unexpected response. Restart the backend, then try again.";
  }
  return fallback;
}

export function useAppSession({ data, onResetWorkspaceChromeRef, setData }) {
  const [authUser, setAuthUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("checking");
  const [authError, setAuthError] = useState("");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [adminUserAccounts, setAdminUserAccounts] = useState([]);
  const [adminUserAccountsError, setAdminUserAccountsError] = useState("");
  const [workspaceStorageMode, setWorkspaceStorageMode] = useState("json");
  const lastSyncedDataRef = useRef("");
  const saveTimeoutRef = useRef(null);
  const syncErrorRef = useRef("");
  const hasLoadedServerStateRef = useRef(false);

  const isAuthenticated = authStatus === "authenticated" && Boolean(authUser);
  const isAuthenticating = authStatus === "authenticating";
  const isTechnician = authUser?.role === "technician";
  const isAdmin = authUser?.role === "admin";
  const canManageBusiness = authUser?.role === "admin" || authUser?.role === "office";

  const clearSessionState = useCallback((message = "", { resetWorkspace = true } = {}) => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    hasLoadedServerStateRef.current = false;
    lastSyncedDataRef.current = "";
    syncErrorRef.current = "";
    setAuthError(message);
    setAuthUser(null);
    setAuthStatus("logged_out");
    setWorkspaceStorageMode("json");
    setLoginForm((prev) => ({ ...prev, password: "" }));
    setAdminUserAccounts([]);
    setAdminUserAccountsError("");

    if (resetWorkspace) {
      setData(normalizeAppState(seedData));
      onResetWorkspaceChromeRef.current?.();
    }
  }, [onResetWorkspaceChromeRef, setData]);

  const fetchWithAuth = useCallback(async (url, options = {}) => {
    const headers = new Headers(options.headers || {});

    return fetch(url, {
      ...options,
      credentials: "same-origin",
      headers,
    });
  }, []);

  const applyServerWorkspaceState = useCallback((incomingState) => {
    const nextState = normalizeAppState(incomingState);
    hasLoadedServerStateRef.current = true;
    lastSyncedDataRef.current = JSON.stringify(nextState);
    syncErrorRef.current = "";
    setData(nextState);
    setAuthError("");
    return nextState;
  }, [setData]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (authStatus !== "checking") {
      return undefined;
    }

    let cancelled = false;

    async function restoreSession() {
      setAuthError("");

      try {
        const meResponse = await fetchWithAuth("/api/auth/me", { method: "GET" });
        const mePayload = await meResponse.json().catch(() => ({}));

        if (meResponse.status === 401) {
          if (cancelled) return;

          hasLoadedServerStateRef.current = false;
          lastSyncedDataRef.current = "";
          syncErrorRef.current = "";
          setAuthUser(null);
          setAdminUserAccounts([]);
          setAdminUserAccountsError("");
          setAuthStatus("logged_out");
          setAuthError("");
          setData(normalizeAppState(seedData));
          return;
        }

        if (!meResponse.ok || !mePayload.user) {
          throw new Error(mePayload.error || "Unable to restore your session.");
        }

        const user = mePayload.user;
        const stateResponse = await fetchWithAuth("/api/app-state", { method: "GET" });
        const statePayload = await stateResponse.json().catch(() => ({}));
        if (!stateResponse.ok) {
          throw new Error(statePayload.error || "Failed to load the shared workspace data.");
        }

        const nextStorageMode = statePayload.storageMode === "sqlite" ? "sqlite" : "json";
        let nextState = normalizeAppState(statePayload.state);

        if (nextStorageMode !== "sqlite" && user?.role !== "technician" && !hasCompletedServerMigration()) {
          const legacyState = getLegacyPersistedState();
          if (legacyState && countBusinessRecords(legacyState) > countBusinessRecords(nextState)) {
            const migrateResponse = await fetchWithAuth("/api/app-state", {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(legacyState),
            });
            const migratePayload = await migrateResponse.json().catch(() => ({}));
            if (!migrateResponse.ok) {
              throw new Error(migratePayload.error || "Failed to migrate your existing browser data to the shared server.");
            }

            nextState = normalizeAppState(migratePayload.state);
          }

          markServerMigrationComplete();
        }

        if (cancelled) return;

        hasLoadedServerStateRef.current = true;
        lastSyncedDataRef.current = JSON.stringify(nextState);
        syncErrorRef.current = "";
        setData(nextState);
        setWorkspaceStorageMode(nextStorageMode);
        setAuthUser(user);
        setAuthStatus("authenticated");
        setAuthError("");
      } catch (error) {
        if (cancelled) return;

        const message = error instanceof Error ? error.message : "Unable to restore your session.";
        clearSessionState(message);
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, [authStatus, clearSessionState, fetchWithAuth, setData]);

  useEffect(() => {
    if (authStatus !== "authenticated") return undefined;

    const intervalId = window.setInterval(() => {
      setData((prev) => purgeExpiredRecycleBinState(prev));
    }, 1000 * 60 * 30);

    return () => window.clearInterval(intervalId);
  }, [authStatus, setData]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !hasLoadedServerStateRef.current) {
      return undefined;
    }

    const nextData = purgeExpiredRecycleBinState(data);
    if (nextData !== data) {
      setData(nextData);
      return undefined;
    }

    const serialized = JSON.stringify(nextData);
    if (serialized === lastSyncedDataRef.current) {
      return undefined;
    }

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        const response = await fetchWithAuth("/api/app-state", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: serialized,
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("Your session expired. Please sign in again.");
          }

          throw new Error(payload.error || "Failed to save the latest changes to the shared workspace.");
        }

        lastSyncedDataRef.current = serialized;
        syncErrorRef.current = "";
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save the latest changes to the shared workspace.";

        if (/session expired|sign in again|authentication required/i.test(message)) {
          clearSessionState(message);
          return;
        }

        if (syncErrorRef.current !== message) {
          window.alert(message);
          syncErrorRef.current = message;
        }
      }
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [authStatus, clearSessionState, data, fetchWithAuth, setData]);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) {
      setAdminUserAccounts([]);
      setAdminUserAccountsError("");
      return undefined;
    }

    let cancelled = false;

    async function loadAdminUserAccounts() {
      try {
        const response = await fetchWithAuth("/api/admin/user-accounts", { method: "GET" });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load login access details.");
        }

        if (cancelled) return;

        setAdminUserAccounts(Array.isArray(payload.accounts) ? payload.accounts : []);
        setAdminUserAccountsError("");
      } catch (error) {
        if (cancelled) return;

        setAdminUserAccounts([]);
        setAdminUserAccountsError(error instanceof Error ? error.message : "Unable to load login access details.");
      }
    }

    loadAdminUserAccounts();

    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, isAdmin, isAuthenticated]);

  function handleLoginFieldChange(field, value) {
    setAuthError("");
    setLoginForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  async function handleLogin() {
    const username = String(loginForm.username || "").trim();
    const password = String(loginForm.password || "");

    if (!username || !password) {
      const message = "Enter your username and password.";
      setAuthError(message);
      return { ok: false, error: message };
    }

    setAuthStatus("authenticating");
    setAuthError("");

    try {
      const { data: signInData, error } = await authClient.signIn.username({
        username,
        password,
        rememberMe: true,
      });

      if (error || !signInData?.user) {
        throw new Error(error?.message || "Unable to sign in.");
      }

      setLoginForm({ username, password: "" });
      setAuthUser(null);
      setAuthStatus("checking");
      setAuthError("");
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign in.";
      setAuthUser(null);
      setAuthStatus("logged_out");
      setAuthError(message);
      setLoginForm((prev) => ({ ...prev, password: "" }));
      return { ok: false, error: message };
    }
  }

  async function handleLogout() {
    try {
      await authClient.signOut();
    } catch {
      // Clear the local session even if the server logout call fails.
    }

    clearSessionState("");
    return { ok: true };
  }

  async function handleSaveStaffLoginAccount(accountInput) {
    if (!isAdmin) {
      return { ok: false, error: "Only admins can manage login access." };
    }

    try {
      const response = await fetchWithAuth("/api/admin/user-accounts", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(accountInput),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.account) {
        throw new Error(payload.error || "Unable to save login access.");
      }

      setAdminUserAccounts((prev) => {
        const nextAccounts = [...prev.filter((entry) => entry.id !== payload.account.id), payload.account];
        nextAccounts.sort((a, b) => {
          if (a.staffId && b.staffId && a.staffId === b.staffId) return 0;
          return (a.name || a.username || "").localeCompare(b.name || b.username || "");
        });
        return nextAccounts;
      });
      setAdminUserAccountsError("");

      return { ok: true, account: payload.account };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to save login access.",
      };
    }
  }

  async function handleDownloadBackup() {
    if (!isAdmin) {
      return { ok: false, error: "Only admins can download a full backup." };
    }

    try {
      const response = await fetchWithAuth("/api/admin/data-backup", { method: "GET" });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to generate the backup file.");
      }

      const backupBlob = await response.blob();
      const filename = getDownloadFilename(response.headers.get("Content-Disposition"));
      const downloadUrl = window.URL.createObjectURL(backupBlob);

      try {
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 1000);
      }

      return { ok: true, filename };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate the backup file.";

      if (/session expired|sign in again|authentication required/i.test(message)) {
        clearSessionState(message);
      }

      return { ok: false, error: message };
    }
  }

  async function handleRestoreBackup(file, password) {
    if (!isAdmin) {
      return { ok: false, error: "Only admins can restore a full backup." };
    }

    if (!file) {
      return { ok: false, error: "Choose a backup file before restoring." };
    }

    if (!String(password || "")) {
      return { ok: false, error: "Re-enter your admin password to continue." };
    }

    try {
      const fileContents = await file.text();
      let parsedBackup = null;

      try {
        parsedBackup = JSON.parse(fileContents);
      } catch {
        throw new Error("The selected file is not valid JSON.");
      }

      const response = await fetchWithAuth("/api/admin/data-backup/restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          backupData: parsedBackup,
          restorePassword: password,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Unable to restore the backup file.");
      }

      const nextState = normalizeAppState(payload.state);
      hasLoadedServerStateRef.current = true;
      lastSyncedDataRef.current = JSON.stringify(nextState);
      syncErrorRef.current = "";
      setData(nextState);
      setAuthError("");

      if (payload.sessionPreserved === false) {
        const nextMessage = payload.message || "Backup restored. Sign in again to continue.";
        setAuthUser(null);
        setAuthStatus("logged_out");
        setAuthError(nextMessage);
        setAdminUserAccounts([]);
        setAdminUserAccountsError("");

        return {
          ok: true,
          message: nextMessage,
          sessionPreserved: false,
        };
      }

      const nextAccounts = Array.isArray(payload.accounts) ? payload.accounts : [];
      const nextUser = payload.user || null;
      setAuthUser(nextUser);
      setAdminUserAccounts(nextUser?.role === "admin" ? nextAccounts : []);
      setAdminUserAccountsError("");

      return {
        ok: true,
        message: payload.message || `${file.name || "Backup file"} restored successfully.`,
        sessionPreserved: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to restore the backup file.";

      if (/session expired|sign in again|authentication required/i.test(message)) {
        clearSessionState(message);
      }

      return { ok: false, error: message };
    }
  }

  async function handlePreviewServiceM8Import(apiKey, options = {}) {
    if (!isAdmin) {
      return { ok: false, error: "Only admins can preview a ServiceM8 import." };
    }

    if (!String(apiKey || "").trim()) {
      return { ok: false, error: "Enter your ServiceM8 API key before previewing the import." };
    }

    try {
      const response = await fetchWithAuth("/api/admin/servicem8-import/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apiKey, options }),
      });
      const { payload, error: responseError } = await readServiceM8ImportResponse(response);

      if (!response.ok || !payload?.ok) {
        throw new Error(getServiceM8ImportError(
          response,
          payload,
          responseError,
          "Unable to preview the ServiceM8 import."
        ));
      }

      return {
        ok: true,
        importedAt: payload.importedAt,
        previewId: payload.previewId || "",
        summary: payload.summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to preview the ServiceM8 import.";

      if (/session expired|sign in again|authentication required/i.test(message)) {
        clearSessionState(message);
      }

      return { ok: false, error: message };
    }
  }

  async function handleApplyServiceM8Import(apiKey, options = {}, previewId = "") {
    if (!isAdmin) {
      return { ok: false, error: "Only admins can run a ServiceM8 import." };
    }

    if (!String(apiKey || "").trim() && !String(previewId || "").trim()) {
      return { ok: false, error: "Preview the ServiceM8 import before importing." };
    }

    try {
      const response = await fetchWithAuth("/api/admin/servicem8-import/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apiKey, options, previewId }),
      });
      const { payload, error: responseError } = await readServiceM8ImportResponse(response);

      if (!response.ok || !payload?.ok) {
        throw new Error(getServiceM8ImportError(
          response,
          payload,
          responseError,
          "Unable to import ServiceM8 data."
        ));
      }

      const nextState = normalizeAppState(payload.state);
      hasLoadedServerStateRef.current = true;
      lastSyncedDataRef.current = JSON.stringify(nextState);
      syncErrorRef.current = "";
      setData(nextState);
      setAuthError("");

      return {
        ok: true,
        importedAt: payload.importedAt,
        summary: payload.summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to import ServiceM8 data.";

      if (/session expired|sign in again|authentication required/i.test(message)) {
        clearSessionState(message);
      }

      return { ok: false, error: message };
    }
  }

  return {
    adminUserAccounts,
    adminUserAccountsError,
    applyServerWorkspaceState,
    authError,
    authStatus,
    authUser,
    canManageBusiness,
    fetchWithAuth,
    handleDownloadBackup,
    handleApplyServiceM8Import,
    handleLogin,
    handleLoginFieldChange,
    handleLogout,
    handlePreviewServiceM8Import,
    handleRestoreBackup,
    handleSaveStaffLoginAccount,
    isAdmin,
    isAuthenticating,
    isAuthenticated,
    isTechnician,
    loginForm,
    workspaceStorageMode,
  };
}
