export const accountingSchemaSql = `
  CREATE TABLE integration_workspace (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    workspace_id TEXT NOT NULL UNIQUE
  );
  INSERT INTO integration_workspace VALUES(1, lower(hex(randomblob(16))));
  CREATE TABLE workspace_integrations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES integration_workspace(workspace_id),
    provider TEXT NOT NULL,
    external_tenant_id TEXT NOT NULL DEFAULT '',
    external_tenant_name TEXT NOT NULL DEFAULT '',
    external_connection_id TEXT NOT NULL DEFAULT '',
    encrypted_access_token TEXT,
    encrypted_refresh_token TEXT,
    token_expires_at INTEGER NOT NULL DEFAULT 0,
    granted_scopes TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'DISCONNECTED',
    config_json TEXT NOT NULL DEFAULT '{}',
    organisations_json TEXT NOT NULL DEFAULT '[]',
    connected_by_user_id TEXT NOT NULL DEFAULT '',
    connected_at TEXT,
    last_success_at TEXT,
    last_error_at TEXT,
    safe_error_message TEXT NOT NULL DEFAULT '',
    retry_after INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(workspace_id, provider)
  );
  CREATE TABLE integration_entity_mappings (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES integration_workspace(workspace_id),
    provider TEXT NOT NULL,
    external_tenant_id TEXT NOT NULL,
    local_entity_type TEXT NOT NULL,
    local_entity_id TEXT NOT NULL,
    external_entity_id TEXT NOT NULL,
    external_reference TEXT NOT NULL DEFAULT '',
    external_fingerprint TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(workspace_id, provider, external_tenant_id, local_entity_type, local_entity_id),
    UNIQUE(provider, external_tenant_id, local_entity_type, external_entity_id)
  );
  CREATE TABLE integration_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL REFERENCES integration_workspace(workspace_id),
    provider TEXT NOT NULL,
    external_tenant_id TEXT NOT NULL DEFAULT '',
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL,
    external_entity_id TEXT NOT NULL DEFAULT '',
    error_code TEXT NOT NULL DEFAULT '',
    safe_error_message TEXT NOT NULL DEFAULT '',
    http_status INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_integration_sync_entity ON integration_sync_log(workspace_id, provider, external_tenant_id, entity_type, entity_id, id DESC);
  CREATE INDEX idx_integration_sync_status ON integration_sync_log(workspace_id, provider, status, created_at);
  CREATE TABLE integration_oauth_states (
    state_hash TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES integration_workspace(workspace_id),
    provider TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_integration_oauth_expiry ON integration_oauth_states(expires_at);
  CREATE TABLE integration_locks (
    workspace_id TEXT NOT NULL REFERENCES integration_workspace(workspace_id),
    provider TEXT NOT NULL,
    owner TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY(workspace_id, provider)
  );
  CREATE TABLE integration_operations (
    workspace_id TEXT NOT NULL REFERENCES integration_workspace(workspace_id),
    provider TEXT NOT NULL,
    external_tenant_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    started_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY(workspace_id, provider, external_tenant_id, entity_type, entity_id)
  );
  UPDATE workspace_info SET schema_version = 9 WHERE id = 1;
`;
