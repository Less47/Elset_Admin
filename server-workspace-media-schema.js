// Media has no FK to live owners: customer/staff archives remove live rows and
// restore the same IDs. Explicit permanent removal cleans media in the same transaction.
export const workspaceMediaSchemaSql = `
  CREATE TABLE workspace_media (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK(owner_type IN ('staff','site')),
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK(mime_type = 'image/webp'),
    size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 8388608),
    image BLOB NOT NULL CHECK(length(image) = size_bytes),
    thumbnail BLOB NOT NULL CHECK(length(thumbnail) BETWEEN 1 AND 262144),
    caption TEXT NOT NULL DEFAULT '' CHECK(length(caption) <= 240),
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_workspace_media_owner ON workspace_media(owner_type,owner_id,created_at DESC,id);
  CREATE UNIQUE INDEX idx_staff_current_avatar ON workspace_media(owner_id) WHERE owner_type='staff';
  CREATE TRIGGER workspace_media_live_owner BEFORE INSERT ON workspace_media
  WHEN (NEW.owner_type='staff' AND NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.owner_id))
    OR (NEW.owner_type='site' AND NOT EXISTS(SELECT 1 FROM sites WHERE id=NEW.owner_id))
  BEGIN SELECT RAISE(ABORT,'Media owner not found'); END;
  ALTER TABLE jobs ADD COLUMN site_id TEXT REFERENCES sites(id) ON DELETE SET NULL;
  CREATE INDEX idx_jobs_explicit_site ON jobs(site_id,created_at DESC,id);
  CREATE TRIGGER jobs_site_owner_insert BEFORE INSERT ON jobs
  WHEN NEW.site_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sites WHERE id=NEW.site_id AND customer_id=NEW.customer_id)
  BEGIN SELECT RAISE(ABORT,'Job Site does not belong to customer'); END;
  CREATE TRIGGER jobs_site_owner_update BEFORE UPDATE OF site_id,customer_id ON jobs
  WHEN NEW.site_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sites WHERE id=NEW.site_id AND customer_id=NEW.customer_id)
  BEGIN SELECT RAISE(ABORT,'Job Site does not belong to customer'); END;
  UPDATE workspace_info SET schema_version=17 WHERE id=1;
`;
