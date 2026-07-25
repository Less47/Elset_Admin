let activeRestore = null;

export class WorkspaceRestoreInProgressError extends Error {
  constructor(message = "A workspace restore is already in progress. Try again shortly.") {
    super(message);
    this.name = "WorkspaceRestoreInProgressError";
    this.statusCode = 423;
  }
}

export function isWorkspaceRestoreInProgress() {
  return Boolean(activeRestore);
}

export function beginWorkspaceRestore() {
  if (activeRestore) {
    throw new WorkspaceRestoreInProgressError();
  }

  const token = Symbol("workspace-restore");
  activeRestore = {
    token,
    startedAt: new Date().toISOString(),
  };

  return activeRestore;
}

export function endWorkspaceRestore(token) {
  if (activeRestore?.token === token) {
    activeRestore = null;
  }
}

export function assertWorkspaceWritable() {
  if (activeRestore) {
    throw new WorkspaceRestoreInProgressError(
      "Workspace restore is in progress. Workspace writes are temporarily blocked."
    );
  }
}
