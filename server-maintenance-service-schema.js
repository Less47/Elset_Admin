// Source job/plan IDs intentionally have no cascading FK: archived and permanently
// removed source records must never erase a signed service report.
export const maintenanceServiceSchemaSql = `
  CREATE TABLE maintenance_service_reports (
    id TEXT PRIMARY KEY,
    maintenance_plan_id TEXT NOT NULL,
    job_id TEXT NOT NULL UNIQUE,
    service_date TEXT NOT NULL,
    technician_id TEXT NOT NULL DEFAULT '',
    technician_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','completed')),
    service_notes TEXT NOT NULL DEFAULT '',
    signature_status TEXT NOT NULL DEFAULT '' CHECK(signature_status IN ('','signed','unavailable','declined')),
    customer_representative_name TEXT NOT NULL DEFAULT '',
    customer_signature_data TEXT NOT NULL DEFAULT '',
    signed_at TEXT NOT NULL DEFAULT '',
    completed_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
    snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
    CHECK(status != 'completed' OR (completed_at != '' AND signature_status != '')),
    CHECK(signature_status != 'signed' OR (customer_representative_name != '' AND customer_signature_data != '' AND signed_at != ''))
  );
  CREATE INDEX idx_maintenance_service_reports_plan ON maintenance_service_reports(maintenance_plan_id,service_date DESC);
  CREATE TABLE maintenance_service_checklist_results (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL REFERENCES maintenance_service_reports(id) ON DELETE RESTRICT,
    source_item_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    standard INTEGER NOT NULL CHECK(standard IN (0,1)),
    position INTEGER NOT NULL CHECK(position > 0),
    text TEXT NOT NULL,
    result TEXT CHECK(result IS NULL OR result IN ('completed','defect','na')),
    notes TEXT NOT NULL DEFAULT '',
    UNIQUE(report_id,position),
    UNIQUE(report_id,source_key),
    UNIQUE(report_id,id)
  );
  CREATE INDEX idx_maintenance_service_results_report ON maintenance_service_checklist_results(report_id,position);
  CREATE TABLE maintenance_service_defects (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL REFERENCES maintenance_service_reports(id) ON DELETE RESTRICT,
    checklist_result_id TEXT NOT NULL UNIQUE,
    severity TEXT NOT NULL CHECK(severity IN ('advisory','action_required','urgent')),
    description TEXT NOT NULL CHECK(length(trim(description)) > 0),
    recommended_action TEXT NOT NULL DEFAULT '',
    photo_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(photo_refs_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(report_id,checklist_result_id) REFERENCES maintenance_service_checklist_results(report_id,id) ON DELETE RESTRICT
  );
  CREATE INDEX idx_maintenance_service_defects_report ON maintenance_service_defects(report_id);
  CREATE TABLE maintenance_service_send_history (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL REFERENCES maintenance_service_reports(id) ON DELETE RESTRICT,
    sent_at TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
  );
  CREATE INDEX idx_maintenance_service_sends_report ON maintenance_service_send_history(report_id,sent_at DESC);
  CREATE TRIGGER maintenance_service_report_locked BEFORE UPDATE ON maintenance_service_reports
    WHEN OLD.status='completed' BEGIN SELECT RAISE(ABORT,'Completed service reports are read-only'); END;
  CREATE TRIGGER maintenance_service_report_preserved BEFORE DELETE ON maintenance_service_reports
    WHEN OLD.status='completed' BEGIN SELECT RAISE(ABORT,'Completed service reports are preserved'); END;
  CREATE TRIGGER maintenance_service_completion_valid BEFORE UPDATE OF status ON maintenance_service_reports
    WHEN NEW.status='completed' AND (
      NOT EXISTS(SELECT 1 FROM maintenance_service_checklist_results WHERE report_id=NEW.id)
      OR EXISTS(SELECT 1 FROM maintenance_service_checklist_results WHERE report_id=NEW.id AND result IS NULL)
      OR EXISTS(SELECT 1 FROM maintenance_service_checklist_results r WHERE r.report_id=NEW.id AND r.result='defect'
        AND NOT EXISTS(SELECT 1 FROM maintenance_service_defects d WHERE d.checklist_result_id=r.id))
    ) BEGIN SELECT RAISE(ABORT,'Service checklist is incomplete'); END;
  ${["maintenance_service_checklist_results", "maintenance_service_defects"].flatMap(table => ["INSERT", "UPDATE", "DELETE"].map(operation => `
    CREATE TRIGGER ${table}_${operation.toLowerCase()}_locked BEFORE ${operation} ON ${table}
      WHEN EXISTS(SELECT 1 FROM maintenance_service_reports WHERE id=${operation === "INSERT" ? "NEW" : "OLD"}.report_id AND status='completed')
      ${operation === "UPDATE" ? "OR EXISTS(SELECT 1 FROM maintenance_service_reports WHERE id=NEW.report_id AND status='completed')" : ""}
      BEGIN SELECT RAISE(ABORT,'Completed service reports are read-only'); END;
  `)).join("\n")}
  UPDATE workspace_info SET schema_version=16 WHERE id=1;
`;
