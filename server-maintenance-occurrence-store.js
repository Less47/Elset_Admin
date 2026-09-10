export function readMaintenanceExceptions(db) {
  return db.prepare(`SELECT maintenance_occurrence_exceptions.*, jobs.id AS live_job_id
    FROM maintenance_occurrence_exceptions LEFT JOIN jobs ON jobs.id = maintenance_occurrence_exceptions.generated_job_id`).all().map((row) => ({
    key: row.occurrence_key, planId: row.plan_id, seriesId: row.series_id,
    originalDate: row.original_date, overrideDate: row.override_date, jobId: row.live_job_id || row.job_id || "", generatedJobId: row.generated_job_id,
    completedAt: row.completed_at, snapshot: JSON.parse(row.snapshot_json),
    createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

export function writeMaintenanceException(db, planId, entry) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO maintenance_occurrence_exceptions
    (occurrence_key, plan_id, series_id, original_date, override_date, job_id, generated_job_id, completed_at, snapshot_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(occurrence_key) DO UPDATE SET override_date = excluded.override_date,
      job_id = excluded.job_id, generated_job_id = excluded.generated_job_id, completed_at = excluded.completed_at,
      snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at
  `).run(entry.key, planId, entry.seriesId, entry.originalDate, entry.overrideDate || "", entry.jobId || null,
    entry.generatedJobId || entry.jobId || "", entry.completedAt || "", JSON.stringify(entry.snapshot), entry.createdAt || now, now);
}
