-- Frozen pre-add-ons schema 7 for additive migration regression tests.
CREATE TABLE workspace_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

CREATE TABLE workspace_info (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        imported_at TEXT,
        source_json_sha256 TEXT,
        importer_version TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}'
      );

CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE document_templates (
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

CREATE TABLE staff (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

CREATE TABLE customers (
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

CREATE TABLE customer_contacts (
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

CREATE TABLE sites (
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

CREATE TABLE site_assets (
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

CREATE TABLE site_access_notes (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
      );

CREATE TABLE maintenance_plans (
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

CREATE TABLE maintenance_checklist_items (
        id TEXT PRIMARY KEY,
        maintenance_plan_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        text TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (maintenance_plan_id) REFERENCES maintenance_plans(id) ON DELETE CASCADE
      );

CREATE TABLE jobs (
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
        extra_json TEXT NOT NULL DEFAULT '{}', service_board_note TEXT DEFAULT NULL
        CHECK (service_board_note IS NULL OR (
          length(service_board_note) BETWEEN 1 AND 25
          AND service_board_note = trim(service_board_note)
          AND instr(service_board_note, char(0)) = 0
          AND instr(service_board_note, char(10)) = 0
          AND instr(service_board_note, char(13)) = 0
        )),
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        FOREIGN KEY (assigned_technician_id) REFERENCES staff(id) ON DELETE SET NULL,
        FOREIGN KEY (maintenance_plan_id) REFERENCES maintenance_plans(id) ON DELETE SET NULL
      );

CREATE TABLE job_notes (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

CREATE TABLE job_attachments (
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

CREATE TABLE quotes (
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

CREATE TABLE quote_line_items (
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

CREATE TABLE invoices (
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

CREATE TABLE invoice_line_items (
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

CREATE TABLE payments (
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

CREATE TABLE document_send_history (
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

CREATE TABLE inventory_items (
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

CREATE TABLE deleted_records (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('job', 'customer')),
        record_id TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

CREATE TABLE service_m8_refs (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        service_m8_uuid TEXT NOT NULL DEFAULT '',
        generated_job_id TEXT NOT NULL DEFAULT '',
        imported_at TEXT NOT NULL DEFAULT '',
        edit_date TEXT NOT NULL DEFAULT '',
        raw_json TEXT NOT NULL DEFAULT '{}'
      );

CREATE TABLE deleted_maintenance_plans (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        customer_id TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        linked_job_ids_json TEXT NOT NULL DEFAULT '[]',
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

CREATE TABLE deleted_inventory_items (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

CREATE TABLE deleted_staff_members (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        assigned_job_ids_json TEXT NOT NULL DEFAULT '[]',
        maintenance_plan_ids_json TEXT NOT NULL DEFAULT '[]',
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

CREATE TABLE maintenance_occurrence_exceptions (
        occurrence_key TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES maintenance_plans(id) ON DELETE CASCADE,
        series_id TEXT NOT NULL,
        original_date TEXT NOT NULL,
        override_date TEXT NOT NULL DEFAULT '',
        job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
        generated_job_id TEXT NOT NULL DEFAULT '',
        completed_at TEXT NOT NULL DEFAULT '',
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(plan_id, series_id, original_date)
      );

CREATE TABLE deleted_invoices (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}'
      );

CREATE INDEX idx_customers_name ON customers(name);

CREATE INDEX idx_customers_email ON customers(email);

CREATE INDEX idx_sites_customer ON sites(customer_id);

CREATE INDEX idx_sites_address ON sites(address);

CREATE INDEX idx_site_assets_site ON site_assets(site_id);

CREATE INDEX idx_site_access_notes_customer ON site_access_notes(customer_id);

CREATE INDEX idx_maintenance_customer ON maintenance_plans(customer_id);

CREATE INDEX idx_maintenance_due ON maintenance_plans(next_due_date);

CREATE INDEX idx_jobs_customer ON jobs(customer_id);

CREATE INDEX idx_jobs_status ON jobs(status);

CREATE INDEX idx_jobs_scheduled_date ON jobs(scheduled_date);

CREATE INDEX idx_jobs_job_number ON jobs(job_number);

CREATE INDEX idx_jobs_maintenance_plan ON jobs(maintenance_plan_id);

CREATE INDEX idx_job_notes_job ON job_notes(job_id);

CREATE INDEX idx_job_attachments_job ON job_attachments(job_id);

CREATE INDEX idx_quote_items_quote ON quote_line_items(quote_id);

CREATE INDEX idx_invoice_items_invoice ON invoice_line_items(invoice_id);

CREATE INDEX idx_payments_invoice ON payments(invoice_id);

CREATE INDEX idx_payments_date ON payments(date);

CREATE INDEX idx_document_send_history_job ON document_send_history(job_id);

CREATE INDEX idx_document_send_history_kind ON document_send_history(document_kind);

CREATE INDEX idx_inventory_sku ON inventory_items(sku);

CREATE INDEX idx_inventory_name ON inventory_items(name);

CREATE INDEX idx_deleted_records_kind ON deleted_records(kind);

CREATE INDEX idx_service_m8_entity ON service_m8_refs(entity_type, entity_id);

CREATE INDEX idx_service_m8_uuid ON service_m8_refs(service_m8_uuid);

CREATE INDEX idx_deleted_maintenance_plan_id ON deleted_maintenance_plans(plan_id);

CREATE INDEX idx_deleted_maintenance_customer ON deleted_maintenance_plans(customer_id);

CREATE INDEX idx_deleted_inventory_item_id ON deleted_inventory_items(item_id);

CREATE INDEX idx_deleted_staff_member_id ON deleted_staff_members(staff_id);

CREATE INDEX idx_deleted_staff_deleted_at ON deleted_staff_members(deleted_at);

CREATE INDEX idx_maintenance_exception_plan ON maintenance_occurrence_exceptions(plan_id);

CREATE INDEX idx_maintenance_exception_date ON maintenance_occurrence_exceptions(override_date);

CREATE UNIQUE INDEX idx_maintenance_exception_job ON maintenance_occurrence_exceptions(job_id) WHERE job_id IS NOT NULL;

CREATE INDEX idx_deleted_invoice_job ON deleted_invoices(job_id);

INSERT INTO workspace_schema_migrations(version,name,applied_at) VALUES (1,'initial-normalized-workspace-schema','2026-09-17T00:06:30.073Z');

INSERT INTO workspace_schema_migrations(version,name,applied_at) VALUES (2,'maintenance-plan-archive-records','2026-09-17T00:06:30.073Z');

INSERT INTO workspace_schema_migrations(version,name,applied_at) VALUES (3,'inventory-item-archive-records','2026-09-17T00:06:30.073Z');

INSERT INTO workspace_schema_migrations(version,name,applied_at) VALUES (4,'staff-member-archive-records','2026-09-17T00:06:30.074Z');

INSERT INTO workspace_schema_migrations(version,name,applied_at) VALUES (5,'maintenance-recurrence-exceptions','2026-09-17T00:06:30.074Z');

INSERT INTO workspace_schema_migrations(version,name,applied_at) VALUES (6,'invoice-archive-records','2026-09-17T00:06:30.074Z');

INSERT INTO workspace_schema_migrations(version,name,applied_at) VALUES (7,'service-board-job-note','2026-09-17T00:06:30.074Z');

INSERT INTO workspace_info(id,schema_version,created_at,updated_at,imported_at,source_json_sha256,importer_version,meta_json) VALUES (1,7,'2026-09-17T00:06:30.073Z','2026-09-17T00:06:30.073Z',NULL,NULL,NULL,'{}');

PRAGMA user_version = 7;
