import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const WORKSPACE_DB_FILENAME = "elset-workspace.db";
export const WORKSPACE_SCHEMA_VERSION = 4;

const migrations = [
  {
    version: 1,
    name: "initial-normalized-workspace-schema",
    sql: `
      CREATE TABLE IF NOT EXISTS workspace_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_info (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        imported_at TEXT,
        source_json_sha256 TEXT,
        importer_version TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS document_templates (
        type TEXT PRIMARY KEY CHECK (type IN ('quote', 'invoice')),
        company_name TEXT NOT NULL DEFAULT '',
        company_abn TEXT NOT NULL DEFAULT '',
        company_acn TEXT NOT NULL DEFAULT '',
        company_email TEXT NOT NULL DEFAULT '',
        company_phone TEXT NOT NULL DEFAULT '',
        company_address TEXT NOT NULL DEFAULT '',
        bank_account_name TEXT NOT NULL DEFAULT '',
        bank_bsb TEXT NOT NULL DEFAULT '',
        bank_account_number TEXT NOT NULL DEFAULT '',
        accent_color TEXT NOT NULL DEFAULT '',
        quote_heading TEXT NOT NULL DEFAULT '',
        intro_text TEXT NOT NULL DEFAULT '',
        notes_heading TEXT NOT NULL DEFAULT '',
        terms_heading TEXT NOT NULL DEFAULT '',
        terms_text TEXT NOT NULL DEFAULT '',
        footer_text TEXT NOT NULL DEFAULT '',
        extra_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS staff (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        customer_type TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        external_refs_json TEXT NOT NULL DEFAULT '{}',
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS customer_contacts (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        site_id TEXT,
        kind TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        site_type TEXT NOT NULL DEFAULT '',
        access_notes TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        contact_name TEXT NOT NULL DEFAULT '',
        contact_phone TEXT NOT NULL DEFAULT '',
        oc_number TEXT NOT NULL DEFAULT '',
        created_at TEXT,
        updated_at TEXT,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS site_assets (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT,
        updated_at TEXT,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS site_access_notes (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS maintenance_plans (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        site_address TEXT NOT NULL DEFAULT '',
        frequency TEXT NOT NULL DEFAULT '',
        next_due_date TEXT NOT NULL DEFAULT '',
        default_technician_id TEXT,
        estimated_duration_hours REAL,
        contract_price_cents INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        last_generated_at TEXT NOT NULL DEFAULT '',
        last_generated_job_id TEXT NOT NULL DEFAULT '',
        last_completed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        FOREIGN KEY (default_technician_id) REFERENCES staff(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS maintenance_checklist_items (
        id TEXT PRIMARY KEY,
        maintenance_plan_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        text TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (maintenance_plan_id) REFERENCES maintenance_plans(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        job_number INTEGER UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        urgency TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        scheduled_date TEXT NOT NULL DEFAULT '',
        assigned_technician_id TEXT,
        assigned_technician_name TEXT NOT NULL DEFAULT '',
        customer_id TEXT NOT NULL,
        customer_name TEXT NOT NULL DEFAULT '',
        customer_email TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        job_address TEXT NOT NULL DEFAULT '',
        oc_number TEXT NOT NULL DEFAULT '',
        requester_contact_json TEXT,
        onsite_contact_json TEXT,
        billing_contact_json TEXT,
        maintenance_plan_id TEXT,
        maintenance_plan_name TEXT NOT NULL DEFAULT '',
        maintenance_due_date TEXT NOT NULL DEFAULT '',
        service_board_tomorrow_date TEXT NOT NULL DEFAULT '',
        service_board_tomorrow_order INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        external_refs_json TEXT NOT NULL DEFAULT '{}',
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        FOREIGN KEY (assigned_technician_id) REFERENCES staff(id) ON DELETE SET NULL,
        FOREIGN KEY (maintenance_plan_id) REFERENCES maintenance_plans(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS job_notes (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS job_attachments (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'photo',
        name TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        path TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER,
        created_at TEXT,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'quote',
        issue_date TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT,
        updated_at TEXT,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS quote_line_items (
        id TEXT PRIMARY KEY,
        quote_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        qty_text TEXT NOT NULL DEFAULT '0',
        quantity_micros INTEGER NOT NULL DEFAULT 0,
        rate_cents INTEGER NOT NULL DEFAULT 0,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'invoice',
        issue_date TEXT NOT NULL DEFAULT '',
        due_date TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        payment_notes TEXT NOT NULL DEFAULT '',
        created_at TEXT,
        updated_at TEXT,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS invoice_line_items (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        qty_text TEXT NOT NULL DEFAULT '0',
        quantity_micros INTEGER NOT NULL DEFAULT 0,
        rate_cents INTEGER NOT NULL DEFAULT 0,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL DEFAULT 0,
        date TEXT NOT NULL DEFAULT '',
        method TEXT NOT NULL DEFAULT '',
        reference TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS document_send_history (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL DEFAULT '',
        document_kind TEXT NOT NULL CHECK (document_kind IN ('quote', 'invoice')),
        quote_id TEXT,
        invoice_id TEXT,
        job_id TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        from_email TEXT NOT NULL DEFAULT '',
        to_email TEXT NOT NULL DEFAULT '',
        to_name TEXT NOT NULL DEFAULT '',
        message_id TEXT NOT NULL DEFAULT '',
        stamp_text TEXT NOT NULL DEFAULT '',
        email_purpose TEXT NOT NULL DEFAULT '',
        job_snapshot_json TEXT,
        document_snapshot_json TEXT,
        template_snapshot_json TEXT,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS inventory_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sku TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        supplier TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        quantity_text TEXT NOT NULL DEFAULT '0',
        quantity_micros INTEGER NOT NULL DEFAULT 0,
        reorder_level_text TEXT NOT NULL DEFAULT '0',
        reorder_level_micros INTEGER NOT NULL DEFAULT 0,
        unit_cost_cents INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS deleted_records (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('job', 'customer')),
        record_id TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS service_m8_refs (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        service_m8_uuid TEXT NOT NULL DEFAULT '',
        generated_job_id TEXT NOT NULL DEFAULT '',
        imported_at TEXT NOT NULL DEFAULT '',
        edit_date TEXT NOT NULL DEFAULT '',
        raw_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
      CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
      CREATE INDEX IF NOT EXISTS idx_sites_customer ON sites(customer_id);
      CREATE INDEX IF NOT EXISTS idx_sites_address ON sites(address);
      CREATE INDEX IF NOT EXISTS idx_site_assets_site ON site_assets(site_id);
      CREATE INDEX IF NOT EXISTS idx_site_access_notes_customer ON site_access_notes(customer_id);
      CREATE INDEX IF NOT EXISTS idx_maintenance_customer ON maintenance_plans(customer_id);
      CREATE INDEX IF NOT EXISTS idx_maintenance_due ON maintenance_plans(next_due_date);
      CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_date ON jobs(scheduled_date);
      CREATE INDEX IF NOT EXISTS idx_jobs_job_number ON jobs(job_number);
      CREATE INDEX IF NOT EXISTS idx_jobs_maintenance_plan ON jobs(maintenance_plan_id);
      CREATE INDEX IF NOT EXISTS idx_job_notes_job ON job_notes(job_id);
      CREATE INDEX IF NOT EXISTS idx_job_attachments_job ON job_attachments(job_id);
      CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_line_items(quote_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_line_items(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
      CREATE INDEX IF NOT EXISTS idx_document_send_history_job ON document_send_history(job_id);
      CREATE INDEX IF NOT EXISTS idx_document_send_history_kind ON document_send_history(document_kind);
      CREATE INDEX IF NOT EXISTS idx_inventory_sku ON inventory_items(sku);
      CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory_items(name);
      CREATE INDEX IF NOT EXISTS idx_deleted_records_kind ON deleted_records(kind);
      CREATE INDEX IF NOT EXISTS idx_service_m8_entity ON service_m8_refs(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_service_m8_uuid ON service_m8_refs(service_m8_uuid);
    `,
  },
  {
    version: 2,
    name: "maintenance-plan-archive-records",
    sql: `
      CREATE TABLE IF NOT EXISTS deleted_maintenance_plans (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        customer_id TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        linked_job_ids_json TEXT NOT NULL DEFAULT '[]',
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_deleted_maintenance_plan_id ON deleted_maintenance_plans(plan_id);
      CREATE INDEX IF NOT EXISTS idx_deleted_maintenance_customer ON deleted_maintenance_plans(customer_id);

      UPDATE workspace_info
         SET schema_version = 2
       WHERE id = 1
         AND schema_version < 2;
    `,
  },
  {
    version: 3,
    name: "inventory-item-archive-records",
    sql: `
      CREATE TABLE IF NOT EXISTS deleted_inventory_items (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_deleted_inventory_item_id ON deleted_inventory_items(item_id);

      UPDATE workspace_info
         SET schema_version = 3
       WHERE id = 1
         AND schema_version < 3;
    `,
  },
  {
    version: 4,
    name: "staff-member-archive-records",
    sql: `
      CREATE TABLE IF NOT EXISTS deleted_staff_members (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        assigned_job_ids_json TEXT NOT NULL DEFAULT '[]',
        maintenance_plan_ids_json TEXT NOT NULL DEFAULT '[]',
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_deleted_staff_member_id ON deleted_staff_members(staff_id);
      CREATE INDEX IF NOT EXISTS idx_deleted_staff_deleted_at ON deleted_staff_members(deleted_at);

      UPDATE workspace_info
         SET schema_version = 4
       WHERE id = 1
         AND schema_version < 4;
    `,
  },
];

export function getWorkspaceDataDir(env = globalThis.process?.env || {}) {
  return path.resolve(env.ELSET_DATA_DIR || path.join(__dirname, "data"));
}

export function getWorkspaceDbPath(env = globalThis.process?.env || {}) {
  return path.resolve(env.ELSET_WORKSPACE_DB_PATH || path.join(getWorkspaceDataDir(env), WORKSPACE_DB_FILENAME));
}

export function configureWorkspacePragmas(db, { readonly = false } = {}) {
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  if (!readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
}

export function migrateWorkspaceSchema(db) {
  configureWorkspacePragmas(db);
  const applyMigrations = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const applied = new Set(
      db.prepare("SELECT version FROM workspace_schema_migrations").all().map((row) => Number(row.version))
    );

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      db.exec(migration.sql);
      db.prepare(`
        INSERT INTO workspace_schema_migrations (version, name, applied_at)
        VALUES (?, ?, ?)
      `).run(migration.version, migration.name, new Date().toISOString());
      db.pragma(`user_version = ${migration.version}`);
    }
  });

  applyMigrations();
  db.pragma("foreign_keys = ON");
  return db;
}

export function openWorkspaceDb({ dbPath = getWorkspaceDbPath(), readonly = false, migrate = true } = {}) {
  if (!readonly && dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath, { readonly });
  configureWorkspacePragmas(db, { readonly });

  if (migrate && !readonly) {
    migrateWorkspaceSchema(db);
  }

  return db;
}
