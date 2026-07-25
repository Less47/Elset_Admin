import {
  defaultInvoiceTemplate,
  defaultQuoteTemplate,
  normalizeDocumentTemplate,
  normalizeInvoiceTemplate,
  normalizeQuoteTemplate,
} from "./src/lib/quote-template.js";
import { WORKSPACE_SCHEMA_VERSION } from "./server-workspace-db.js";
import {
  defaultWorkspaceSettings,
  isWorkspaceSecretSettingKey,
  workspacePreferenceSettingKeys,
  workspaceUiSettingKeys,
} from "./server-workspace-setting-keys.js";
import { loadWorkspaceStateFromDb } from "./server-workspace-state.js";

const sidebarWidthValues = new Set(["icon-only", "compact", "standard", "wide"]);
const contentDensityValues = new Set(["compact", "comfortable", "spacious"]);
const colorSettingKeys = new Set([
  "pageBackgroundStart",
  "pageBackgroundEnd",
  "sidebarSurface",
  "sidebarHeader",
  "sidebarActive",
  "heroSurface",
  "actionColor",
  "borderColor",
  "dialogSurface",
  "dataViewSurface",
  "dataViewAccent",
]);
const emailSettingKeys = new Set([
  "companyEmail",
  "defaultSenderEmail",
  "replyToEmail",
  "quoteCcEmail",
  "invoiceCcEmail",
]);
const textSettingKeys = new Set([
  "companyName",
  "companyAbn",
  "companyAcn",
  "companyPhone",
  "companyAddress",
  "bankAccountName",
  "bankBsb",
  "bankAccountNumber",
  "emailSignature",
]);
const protectedCounterKeys = new Set([
  "jobNumber",
  "nextJobNumber",
  "lastJobNumber",
  "quoteNumber",
  "nextQuoteNumber",
  "lastQuoteNumber",
  "invoiceNumber",
  "nextInvoiceNumber",
  "lastInvoiceNumber",
]);
const knownSettingKeys = new Set([
  ...workspaceUiSettingKeys,
  ...workspacePreferenceSettingKeys,
]);
const documentTemplateKnownKeys = new Set([
  "companyName",
  "companyAbn",
  "companyAcn",
  "companyEmail",
  "companyPhone",
  "companyAddress",
  "bankAccountName",
  "bankBsb",
  "bankAccountNumber",
  "accentColor",
  "quoteHeading",
  "introText",
  "notesHeading",
  "termsHeading",
  "termsText",
  "footerText",
]);

export class WorkspaceSettingsError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "WorkspaceSettingsError";
    this.statusCode = statusCode;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "");
}

function trimText(value) {
  return text(value).trim();
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function objectJson(value) {
  return json(value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

function assertPlainObject(value, label = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceSettingsError(`${label} must be an object.`);
  }
}

function normalizeKey(key, label = "Setting key") {
  const normalized = trimText(key);
  if (!normalized) throw new WorkspaceSettingsError(`${label} is required.`);
  if (normalized.length > 120) throw new WorkspaceSettingsError(`${label} is too long.`);
  return normalized;
}

function isHexColor(value) {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

function normalizeHexColor(value, label) {
  if (!isHexColor(value)) throw new WorkspaceSettingsError(`${label} must be a valid hex colour.`);
  const trimmed = value.trim();
  if (trimmed.length === 7) return trimmed.toUpperCase();
  const [r, g, b] = trimmed.slice(1).split("");
  return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
}

function normalizeEmail(value, label, { allowEmpty = true } = {}) {
  const email = trimText(value);
  if (!email && allowEmpty) return "";
  if (!email) throw new WorkspaceSettingsError(`${label} is required.`);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new WorkspaceSettingsError(`${label} is invalid.`);
  }
  return email;
}

function normalizeUrl(value, label) {
  const url = trimText(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Unsupported protocol.");
    }
    return parsed.toString();
  } catch {
    throw new WorkspaceSettingsError(`${label} must be a valid URL.`);
  }
}

function normalizePercent(value, label) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) throw new WorkspaceSettingsError(`${label} must be a valid percentage.`);
  if (percent < 0 || percent > 100) throw new WorkspaceSettingsError(`${label} must be between 0 and 100.`);
  return percent;
}

function normalizeCurrency(value, label) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new WorkspaceSettingsError(`${label} must be a valid currency value.`);
  if (amount < 0) throw new WorkspaceSettingsError(`${label} cannot be negative.`);
  return Number(amount.toFixed(2));
}

function isProtectedCounterKey(key) {
  const normalized = key.toLowerCase();
  return protectedCounterKeys.has(key) || (
    normalized.includes("number")
    && (normalized.includes("next") || normalized.includes("last") || normalized.includes("counter"))
  );
}

function validateSafeWorkspaceSettingKey(key) {
  if (isWorkspaceSecretSettingKey(key)) {
    throw new WorkspaceSettingsError("Secrets and API credentials cannot be stored in workspace settings.");
  }
  if (isProtectedCounterKey(key)) {
    throw new WorkspaceSettingsError("Document and job numbering counters are server-controlled and cannot be edited here.");
  }
}

function normalizeUnknownSetting(key, value) {
  if (/url$/i.test(key)) return normalizeUrl(value, key);
  if (/(percent|percentage|gstRate|taxRate)$/i.test(key)) return normalizePercent(value, key);
  if (/(amount|price|rate|cost|fee)$/i.test(key)) return normalizeCurrency(value, key);
  if (/date$/i.test(key)) {
    const dateValue = trimText(value);
    if (!dateValue || /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue;
    throw new WorkspaceSettingsError(`${key} must be a valid date.`);
  }
  return value;
}

function normalizeSettingValue(key, value) {
  validateSafeWorkspaceSettingKey(key);

  if (colorSettingKeys.has(key)) return normalizeHexColor(value, key);
  if (emailSettingKeys.has(key)) return normalizeEmail(value, key);
  if (textSettingKeys.has(key)) return text(value);
  if (key === "sidebarWidth") {
    const normalized = trimText(value);
    if (!sidebarWidthValues.has(normalized)) throw new WorkspaceSettingsError("Sidebar width is invalid.");
    return normalized;
  }
  if (key === "contentDensity") {
    const normalized = trimText(value);
    if (!contentDensityValues.has(normalized)) throw new WorkspaceSettingsError("Content density is invalid.");
    return normalized;
  }

  return normalizeUnknownSetting(key, value);
}

function normalizeSettingsPatch(input) {
  assertPlainObject(input, "Settings");
  return Object.entries(input).reduce((patch, [rawKey, rawValue]) => {
    const key = normalizeKey(rawKey);
    patch[key] = normalizeSettingValue(key, rawValue);
    return patch;
  }, {});
}

function normalizeResetGroup(value) {
  const group = trimText(value);
  if (group === "ui" || group === "preferences") return group;
  throw new WorkspaceSettingsError("Settings reset group is invalid.");
}

function pickSettings(source, keys) {
  return keys.reduce((selected, key) => {
    selected[key] = source[key];
    return selected;
  }, {});
}

function normalizeTemplateType(typeInput) {
  const type = trimText(typeInput);
  if (type === "quote" || type === "invoice") return type;
  throw new WorkspaceSettingsError("Document template type is invalid.");
}

function pickExtra(record, knownKeys) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return {};
  const extra = {};
  for (const [key, value] of Object.entries(record)) {
    if (knownKeys.has(key)) continue;
    validateSafeWorkspaceSettingKey(key);
    extra[key] = normalizeUnknownSetting(key, value);
  }
  return extra;
}

function normalizeTemplateInput(type, input) {
  assertPlainObject(input, "Document template");
  const normalized = normalizeDocumentTemplate(input, type);
  return {
    companyName: text(normalized.companyName),
    companyAbn: text(normalized.companyAbn),
    companyAcn: text(normalized.companyAcn),
    companyEmail: normalizeEmail(normalized.companyEmail, "Company email"),
    companyPhone: text(normalized.companyPhone),
    companyAddress: text(normalized.companyAddress),
    bankAccountName: text(normalized.bankAccountName),
    bankBsb: text(normalized.bankBsb),
    bankAccountNumber: text(normalized.bankAccountNumber),
    accentColor: normalizeHexColor(normalized.accentColor, "Template accent colour"),
    quoteHeading: text(normalized.quoteHeading),
    introText: text(normalized.introText),
    notesHeading: text(normalized.notesHeading),
    termsHeading: text(normalized.termsHeading),
    termsText: text(normalized.termsText),
    footerText: text(normalized.footerText),
    extra: pickExtra(input, documentTemplateKnownKeys),
  };
}

function touchWorkspaceInfo(db, updatedAt = nowIso()) {
  db.prepare(`
    INSERT INTO workspace_info (id, schema_version, created_at, updated_at, meta_json)
    VALUES (1, ?, ?, ?, '{}')
    ON CONFLICT(id) DO UPDATE SET
      schema_version = max(workspace_info.schema_version, excluded.schema_version),
      updated_at = excluded.updated_at
  `).run(WORKSPACE_SCHEMA_VERSION, updatedAt, updatedAt);
}

function runForeignKeyCheck(db) {
  const errors = db.prepare("PRAGMA foreign_key_check").all();
  if (errors.length > 0) {
    throw new WorkspaceSettingsError(`Workspace relationship validation failed: ${JSON.stringify(errors)}`, 500);
  }
}

function getSettingsState(db) {
  return loadWorkspaceStateFromDb(db).settings;
}

function getTemplateState(db, type) {
  const state = loadWorkspaceStateFromDb(db);
  return type === "invoice" ? state.invoiceTemplate : state.quoteTemplate;
}

function upsertSetting(db, key, value, updatedAt) {
  db.prepare(`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(key, json(value), updatedAt);
}

function upsertDocumentTemplate(db, type, template, updatedAt) {
  db.prepare(`
    INSERT INTO document_templates (
      type, company_name, company_abn, company_acn, company_email, company_phone, company_address,
      bank_account_name, bank_bsb, bank_account_number, accent_color, quote_heading, intro_text,
      notes_heading, terms_heading, terms_text, footer_text, extra_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(type) DO UPDATE SET
      company_name = excluded.company_name,
      company_abn = excluded.company_abn,
      company_acn = excluded.company_acn,
      company_email = excluded.company_email,
      company_phone = excluded.company_phone,
      company_address = excluded.company_address,
      bank_account_name = excluded.bank_account_name,
      bank_bsb = excluded.bank_bsb,
      bank_account_number = excluded.bank_account_number,
      accent_color = excluded.accent_color,
      quote_heading = excluded.quote_heading,
      intro_text = excluded.intro_text,
      notes_heading = excluded.notes_heading,
      terms_heading = excluded.terms_heading,
      terms_text = excluded.terms_text,
      footer_text = excluded.footer_text,
      extra_json = excluded.extra_json,
      updated_at = excluded.updated_at
  `).run(
    type,
    template.companyName,
    template.companyAbn,
    template.companyAcn,
    template.companyEmail,
    template.companyPhone,
    template.companyAddress,
    template.bankAccountName,
    template.bankBsb,
    template.bankAccountNumber,
    template.accentColor,
    template.quoteHeading,
    template.introText,
    template.notesHeading,
    template.termsHeading,
    template.termsText,
    template.footerText,
    objectJson(template.extra),
    updatedAt
  );
}

export function updateWorkspaceSettings(db, input) {
  const patch = normalizeSettingsPatch(input);

  return db.transaction(() => {
    const updatedAt = nowIso();
    for (const [key, value] of Object.entries(patch)) {
      upsertSetting(db, key, value, updatedAt);
    }
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return {
      settings: getSettingsState(db),
      updatedKeys: Object.keys(patch),
    };
  })();
}

export function resetWorkspaceSettings(db, groupInput) {
  const group = normalizeResetGroup(groupInput);
  const patch = normalizeSettingsPatch(
    pickSettings(defaultWorkspaceSettings, group === "ui" ? workspaceUiSettingKeys : workspacePreferenceSettingKeys)
  );

  return db.transaction(() => {
    const updatedAt = nowIso();
    for (const [key, value] of Object.entries(patch)) {
      upsertSetting(db, key, value, updatedAt);
    }
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return {
      settings: getSettingsState(db),
      resetGroup: group,
      updatedKeys: Object.keys(patch),
    };
  })();
}

export function updateDocumentTemplate(db, typeInput, input) {
  const type = normalizeTemplateType(typeInput);
  const template = normalizeTemplateInput(type, input);

  return db.transaction(() => {
    const updatedAt = nowIso();
    upsertDocumentTemplate(db, type, template, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return {
      type,
      template: getTemplateState(db, type),
    };
  })();
}

export function resetDocumentTemplate(db, typeInput) {
  const type = normalizeTemplateType(typeInput);
  const template = normalizeTemplateInput(
    type,
    type === "invoice" ? normalizeInvoiceTemplate(defaultInvoiceTemplate) : normalizeQuoteTemplate(defaultQuoteTemplate)
  );

  return db.transaction(() => {
    const updatedAt = nowIso();
    upsertDocumentTemplate(db, type, template, updatedAt);
    touchWorkspaceInfo(db, updatedAt);
    runForeignKeyCheck(db);
    return {
      type,
      template: getTemplateState(db, type),
    };
  })();
}

export { isWorkspaceSecretSettingKey, knownSettingKeys };
