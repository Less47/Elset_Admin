import { isSqliteWorkspaceMode } from "./workspace-customer-api.js";

export function shouldRunRecycleBinClientPrune({ authStatus, workspaceStorageMode }) {
  return authStatus === "authenticated" && !isSqliteWorkspaceMode(workspaceStorageMode);
}

export function shouldAttemptBroadWorkspaceAutosave({
  authStatus,
  hasLoadedServerState,
  workspaceStorageMode,
  serializedState,
  lastSyncedState,
}) {
  if (authStatus !== "authenticated") return false;
  if (!hasLoadedServerState) return false;
  if (isSqliteWorkspaceMode(workspaceStorageMode)) return false;
  if (!serializedState || serializedState === lastSyncedState) return false;
  return true;
}
