import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUTH_DISABLED,
  LOCAL_AUTH_USER,
  countBusinessRecords,
  getLegacyPersistedState,
  getStoredAuthToken,
  hasCompletedServerMigration,
  markServerMigrationComplete,
  normalizeAppState,
  persistAuthToken,
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

export function useAppSession({ data, onResetWorkspaceChromeRef, setData }) {
  const [authToken, setAuthToken] = useState(() => (AUTH_DISABLED ? "" : getStoredAuthToken()));
  const [authUser, setAuthUser] = useState(() => (AUTH_DISABLED ? LOCAL_AUTH_USER : null));
  const [authStatus, setAuthStatus] = useState(() => (AUTH_DISABLED ? "checking" : (getStoredAuthToken() ? "checking" : "logged_out")));
  const [authError, setAuthError] = useState("");
  const [adminUserAccounts, setAdminUserAccounts] = useState([]);
  const [adminUserAccountsError, setAdminUserAccountsError] = useState("");
  const lastSyncedDataRef = useRef("");
  const saveTimeoutRef = useRef(null);
  const syncErrorRef = useRef("");
  const hasLoadedServerStateRef = useRef(false);

  const isAuthenticated = authStatus === "authenticated" && Boolean(authUser);
  const isTechnician = authUser?.role === "technician";
  const isAdmin = authUser?.role === "admin";
  const canManageBusiness = authUser?.role === "admin" || authUser?.role === "office";

  const clearSessionState = useCallback((message = "") => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    hasLoadedServerStateRef.current = false;
    lastSyncedDataRef.current = "";
    syncErrorRef.current = "";
    setAuthToken("");
    setAuthError(message);
    setAdminUserAccounts([]);
    setAdminUserAccountsError("");
    setData(normalizeAppState(seedData));
    onResetWorkspaceChromeRef.current?.();

    if (AUTH_DISABLED) {
      setAuthUser(LOCAL_AUTH_USER);
      setAuthStatus("authenticated");
      return;
    }

    setAuthUser(null);
    setAuthStatus("logged_out");
  }, [onResetWorkspaceChromeRef, setData]);

  const fetchWithAuth = useCallback(async (url, options = {}, tokenOverride) => {
    const headers = new Headers(options.headers || {});
    const resolvedToken = tokenOverride ?? authToken;

    if (resolvedToken) {
      headers.set("Authorization", `Bearer ${resolvedToken}`);
    }

    return fetch(url, {
      ...options,
      headers,
    });
  }, [authToken]);

  useEffect(() => {
    if (AUTH_DISABLED) {
      persistAuthToken("");
      return;
    }

    persistAuthToken(authToken);
  }, [authToken]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (AUTH_DISABLED) {
        setAuthStatus("checking");
        setAuthError("");

        try {
          const stateResponse = await fetchWithAuth("/api/app-state", { method: "GET" }, "");
          const statePayload = await stateResponse.json().catch(() => ({}));
          if (!stateResponse.ok) {
            throw new Error(statePayload.error || "Failed to load the shared workspace data.");
          }

          let nextState = normalizeAppState(statePayload.state);

          if (!hasCompletedServerMigration()) {
            const legacyState = getLegacyPersistedState();
            if (legacyState && countBusinessRecords(legacyState) > countBusinessRecords(nextState)) {
              const migrateResponse = await fetchWithAuth(
                "/api/app-state",
                {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(legacyState),
                },
                ""
              );
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
          setAuthUser(LOCAL_AUTH_USER);
          setAuthToken("");
          setAuthStatus("authenticated");
          setAuthError("");
          return;
        } catch (error) {
          if (cancelled) return;

          const message = error instanceof Error ? error.message : "Unable to load the shared workspace data.";
          hasLoadedServerStateRef.current = false;
          lastSyncedDataRef.current = "";
          syncErrorRef.current = "";
          setData(normalizeAppState(seedData));
          setAuthUser(LOCAL_AUTH_USER);
          setAuthToken("");
          setAuthStatus("authenticated");
          setAuthError(message);
          return;
        }
      }

      if (!authToken) {
        hasLoadedServerStateRef.current = false;
        lastSyncedDataRef.current = "";
        syncErrorRef.current = "";
        setAuthUser(null);
        setAdminUserAccounts([]);
        setAdminUserAccountsError("");
        setAuthStatus("logged_out");
        setData(normalizeAppState(seedData));
        return;
      }

      setAuthStatus("checking");
      setAuthError("");

      try {
        const meResponse = await fetchWithAuth("/api/auth/me", { method: "GET" }, authToken);
        const mePayload = await meResponse.json().catch(() => ({}));
        if (!meResponse.ok) {
          throw new Error(mePayload.error || "Your session has expired. Please sign in again.");
        }

        const user = mePayload.user;
        const stateResponse = await fetchWithAuth("/api/app-state", { method: "GET" }, authToken);
        const statePayload = await stateResponse.json().catch(() => ({}));
        if (!stateResponse.ok) {
          throw new Error(statePayload.error || "Failed to load the shared workspace data.");
        }

        let nextState = normalizeAppState(statePayload.state);

        if (user?.role !== "technician" && !hasCompletedServerMigration()) {
          const legacyState = getLegacyPersistedState();
          if (legacyState && countBusinessRecords(legacyState) > countBusinessRecords(nextState)) {
            const migrateResponse = await fetchWithAuth(
              "/api/app-state",
              {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(legacyState),
              },
              authToken
            );
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
  }, [authToken, clearSessionState, fetchWithAuth, setData]);

  useEffect(() => {
    if (authStatus !== "authenticated") return undefined;

    const intervalId = window.setInterval(() => {
      setData((prev) => purgeExpiredRecycleBinState(prev));
    }, 1000 * 60 * 30);

    return () => window.clearInterval(intervalId);
  }, [authStatus, setData]);

  useEffect(() => {
    if (authStatus !== "authenticated" || (!AUTH_DISABLED && !authToken) || !hasLoadedServerStateRef.current) {
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
  }, [authStatus, authToken, clearSessionState, data, fetchWithAuth, setData]);

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

  async function handleSaveStaffLoginAccount(accountInput) {
    if (!isAdmin || (!AUTH_DISABLED && !authToken)) {
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
    if (!isAdmin || (!AUTH_DISABLED && !authToken)) {
      return { ok: false, error: "Only admins can download a full backup." };
    }

    try {
      const response = await fetchWithAuth("/api/admin/data-backup", { method: "GET" });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("The backup API needs a backend restart before data backup is available.");
        }

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

  async function handleRestoreBackup(file) {
    if (!isAdmin || (!AUTH_DISABLED && !authToken)) {
      return { ok: false, error: "Only admins can restore a full backup." };
    }

    if (!file) {
      return { ok: false, error: "Choose a backup file before restoring." };
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
        body: JSON.stringify(parsedBackup),
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
      setAdminUserAccounts(Array.isArray(payload.accounts) ? payload.accounts : []);
      setAdminUserAccountsError("");
      setAuthError("");

      if (payload.user) {
        setAuthUser(payload.user);
      }

      return {
        ok: true,
        message: payload.message || `${file.name || "Backup file"} restored successfully.`,
        sessionPreserved: payload.sessionPreserved !== false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to restore the backup file.";

      if (/session expired|sign in again|authentication required/i.test(message)) {
        clearSessionState(message);
      }

      return { ok: false, error: message };
    }
  }

  return {
    adminUserAccounts,
    adminUserAccountsError,
    authError,
    authStatus,
    authToken,
    authUser,
    canManageBusiness,
    handleDownloadBackup,
    handleRestoreBackup,
    handleSaveStaffLoginAccount,
    isAdmin,
    isAuthenticated,
    isTechnician,
  };
}
