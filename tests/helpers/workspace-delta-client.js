import assert from "node:assert/strict";
import { getAuthorizedWorkspaceState } from "../../server-workspace-storage.js";
import { applyWorkspaceDelta } from "../../src/hooks/workspace-delta.js";

const servers = new Map();
export function registerDeltaTestServer(url, env, user = {}) {
  servers.set(url, { env, user: { role: "admin", ...user } });
}
export function unregisterDeltaTestServer(url) { servers.delete(url); }

export function beforeDeltaRequest(url) {
  const server = servers.get(url);
  try { return getAuthorizedWorkspaceState(server.user, { env: server.env }); }
  catch { return null; } // Tests also exercise a missing/invalid database.
}

function ordered(state) {
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [key, Array.isArray(value)
    ? [...value].sort((a, b) => String(a.id || a.job?.id || a.customer?.id).localeCompare(String(b.id || b.job?.id || b.customer?.id))) : value]));
}

export function verifyDeltaResponse(url, before, payload) {
  if (!payload.ok || !payload.delta) return before;
  assert.equal(payload.state, undefined, "ordinary successes must not include workspace state");
  const workspace = applyWorkspaceDelta(before, payload.delta);
  const server = servers.get(url);
  const authoritative = getAuthorizedWorkspaceState(server.user, { env: server.env });
  assert.deepEqual(ordered(workspace), ordered(authoritative), "applying the delta must reproduce authoritative state, including side effects");
  return workspace;
}
