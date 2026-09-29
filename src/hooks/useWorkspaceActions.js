import { useLocation, useMatches, useNavigate } from "react-router";
import { recordLinkState } from "@/lib/record-link-state";
import { useCallback, useRef, useState } from "react";
import { createJobStatusQueue, mergeJobStatusFields, requestJobStatusUpdate } from "./workspace-job-status";
import { normalizeServiceBoardNote } from "@/lib/service-board-note";
import { effectiveMaintenancePlan } from "@/lib/maintenance-recurrence";
import { siteAddressMetadata, updatedSiteAddressMetadata } from "@/lib/site-location";
import { canonicalMaintenancePlanInput } from "@/lib/maintenance-plan";
import { calendarUndoRequest } from "@/components/calendar/calendar-undo";
import {
  addDaysToDateInput,
  normalizeCustomerRecord,
  normalizeDocument,
  normalizeInventoryRecord,
  normalizeJobContactSnapshot,
  normalizeMaintenancePlanRecord,
  normalizeSiteAddress,
  normalizeSiteProfileRecord,
  slugDate,
  toDateInputValue,
} from "@/lib/app-support";
import {
  ADMIN_EMAIL,
  buildTemplateWithBusinessDetails,
  getDocumentRecipientEmail,
  getDocumentRecipientName,
  normalizeInvoiceTemplate,
  normalizeQuoteTemplate,
} from "@/lib/quote-template";
import {
  requestCustomerWorkspaceUpdate,
  requestDocumentWorkspaceUpdate,
  requestInventoryWorkspaceUpdate,
  requestMaintenanceWorkspaceUpdate,
  requestStaffWorkspaceUpdate,
  requestWorkspaceUpdate,
} from "./workspace-customer-api";
import { sendDocumentAndPersistHistory } from "./document-send-workflow";
import { buildDocumentPdfPayload } from "../lib/document-pdf-payload.js";
import { createDocumentEmailDraft, documentContactSuggestions } from "../lib/document-email.js";
import { recipientList } from "../lib/recipient-display.js";
import { getSupportedInvoiceUpdateKeys } from "./workspace-invoice-updates";
import { withDocumentSiteSnapshot } from "@/lib/document-site-snapshot";

export function useWorkspaceActions({
  applyServerWorkspaceState,
  canManageBusiness,
  data,
  docType,
  fetchWithAuth,
  selectedFreshJob,
  setData,
  setIsSendingDocument,
  themeSettings,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const match = useMatches().at(-1);
  const linkState = recordLinkState(location, match, data.jobs);
  const documentSendInFlightRef = useRef(false);
  const invoiceArchiveInFlightRef = useRef(false);
  const boardNoteSavesRef = useRef(new Set());
  const [queueJobStatus] = useState(() => createJobStatusQueue());

  function applyServerState(state) {
    if (typeof applyServerWorkspaceState === "function") {
      return applyServerWorkspaceState(state);
    }

    setData(state);
    return state;
  }

  const applyCustomerServerState = applyServerState;

  async function saveCustomerApiRequest({
    path,
    method = "POST",
    body,
    errorMessage = "Unable to update the customer records.",
  }) {
    try {
      const payload = await requestCustomerWorkspaceUpdate({
        fetchWithAuth,
        path,
        method,
        body,
        errorMessage,
      });
      const state = applyCustomerServerState(payload.state);
      return { ok: true, payload, result: payload.result, state };
    } catch (error) {
      window.alert(error instanceof Error ? error.message : errorMessage);
      return { ok: false, result: null, state: null };
    }
  }

  async function saveJobApiRequest({
    path,
    method = "POST",
    body,
    errorMessage = "Unable to update the job records.",
    onError,
  }) {
    try {
      const payload = await requestWorkspaceUpdate({
        fetchWithAuth,
        path,
        method,
        body,
        errorMessage,
      });
      const state = applyServerState(payload.state);
      return { ok: true, payload, result: payload.result, state };
    } catch (error) {
      if (onError) onError(error);
      else window.alert(error instanceof Error ? error.message : errorMessage);
      return { ok: false, result: null, state: null };
    }
  }

  async function saveDocumentApiRequest({
    path,
    method = "POST",
    body,
    errorMessage = "Unable to update the document records.",
  }) {
    try {
      const payload = await requestDocumentWorkspaceUpdate({
        fetchWithAuth,
        path,
        method,
        body,
        errorMessage,
      });
      const state = applyServerState(payload.state);
      return { ok: true, payload, result: payload.result, state };
    } catch (error) {
      if (!documentSendInFlightRef.current) window.alert(error instanceof Error ? error.message : errorMessage);
      return { ok: false, result: null, state: null };
    }
  }

  async function saveInventoryApiRequest({
    path,
    method = "POST",
    body,
    errorMessage = "Unable to update the inventory records.",
  }) {
    try {
      const payload = await requestInventoryWorkspaceUpdate({
        fetchWithAuth,
        path,
        method,
        body,
        errorMessage,
      });
      const state = applyServerState(payload.state);
      return { ok: true, payload, result: payload.result, state };
    } catch (error) {
      window.alert(error instanceof Error ? error.message : errorMessage);
      return { ok: false, result: null, state: null };
    }
  }

  async function saveMaintenanceApiRequest({
    path,
    method = "POST",
    body,
    errorMessage = "Unable to update the maintenance records.",
    throwOnError = false,
  }) {
    try {
      const payload = await requestMaintenanceWorkspaceUpdate({
        fetchWithAuth,
        path,
        method,
        body,
        errorMessage,
      });
      const state = applyServerState(payload.state);
      return { ok: true, payload, result: payload.result, state };
    } catch (error) {
      if (throwOnError) throw error;
      window.alert(error instanceof Error ? error.message : errorMessage);
      return { ok: false, result: null, state: null };
    }
  }

  async function saveStaffApiRequest({
    path,
    method = "POST",
    body,
    errorMessage = "Unable to update the staff records.",
  }) {
    try {
      const payload = await requestStaffWorkspaceUpdate({
        fetchWithAuth,
        path,
        method,
        body,
        errorMessage,
      });
      const state = applyServerState(payload.state);
      return { ok: true, payload, result: payload.result, state };
    } catch (error) {
      window.alert(error instanceof Error ? error.message : errorMessage);
      return { ok: false, result: null, state: null };
    }
  }

  function customerPath(customerId, suffix = "") {
    return `/api/customers/${encodeURIComponent(String(customerId || ""))}${suffix}`;
  }

  function jobPath(jobId, suffix = "") {
    return `/api/jobs/${encodeURIComponent(String(jobId || ""))}${suffix}`;
  }

  function documentPath(jobId, type, suffix = "") {
    const documentType = type === "invoice" ? "invoice" : "quote";
    return jobPath(jobId, `/${documentType}${suffix}`);
  }

  function inventoryPath(itemId = "", suffix = "") {
    const normalizedItemId = String(itemId || "").trim();
    return normalizedItemId
      ? `/api/inventory-items/${encodeURIComponent(normalizedItemId)}${suffix}`
      : "/api/inventory-items";
  }

  function maintenancePath(planId = "", suffix = "") {
    const normalizedPlanId = String(planId || "").trim();
    return normalizedPlanId
      ? `/api/maintenance-plans/${encodeURIComponent(normalizedPlanId)}${suffix}`
      : "/api/maintenance-plans";
  }

  function staffPath(staffId = "", suffix = "") {
    const normalizedStaffId = String(staffId || "").trim();
    return normalizedStaffId
      ? `/api/staff/${encodeURIComponent(normalizedStaffId)}${suffix}`
      : "/api/staff";
  }


  function getTomorrowPlanningDate() {
    return addDaysToDateInput(toDateInputValue(new Date()), 1);
  }

  async function createJob({ job, customerMode, customer, siteInput = null }) {
    if (!canManageBusiness) return;

    const saved = await saveJobApiRequest({
      path: "/api/jobs",
      method: "POST",
      body: {
        job,
        customerMode,
        customer,
        siteInput,
      },
      errorMessage: "Unable to create the job.",
    });
    return saved.ok ? saved.result : null;
  }

  async function handleCreateStaff(staffInput) {
    if (!canManageBusiness) return null;

    const createdStaff = {
      id: crypto.randomUUID(),
      ...staffInput,
      createdAt: new Date().toISOString(),
    };
    const saved = await saveStaffApiRequest({
      path: staffPath(),
      method: "POST",
      body: { staff: createdStaff },
      errorMessage: "Unable to create the staff member.",
    });
    return saved.ok ? saved.result : null;
  }

  async function handleUpdateStaff(staffId, updates) {
    if (!canManageBusiness) return null;

    const saved = await saveStaffApiRequest({
      path: staffPath(staffId),
      method: "PATCH",
      body: { staff: updates },
      errorMessage: "Unable to save the staff member.",
    });
    return saved.ok ? saved.result : null;
  }

  async function handleCreateInventoryItem(partInput) {
    if (!canManageBusiness) return false;

    const createdPart = normalizeInventoryRecord({
      id: crypto.randomUUID(),
      ...partInput,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const saved = await saveInventoryApiRequest({
      path: inventoryPath(),
      method: "POST",
      body: { item: createdPart },
      errorMessage: "Unable to create the inventory item.",
    });
    return saved.ok ? (saved.result || true) : false;
  }

  async function handleUpdateInventoryItem(partId, updates) {
    if (!canManageBusiness) return false;

    const saved = await saveInventoryApiRequest({
      path: inventoryPath(partId),
      method: "PATCH",
      body: { item: updates },
      errorMessage: "Unable to save the inventory item.",
    });
    return saved.ok ? (saved.result || true) : false;
  }

  async function handleDeleteInventoryItem(partId) {
    if (!canManageBusiness) return false;

    const part = (data.inventoryItems || []).find((entry) => entry.id === partId);
    if (!part) return false;

    const confirmed = window.confirm(`Delete ${part.name} from parts inventory?`);
    if (!confirmed) return false;

    const saved = await saveInventoryApiRequest({
      path: inventoryPath(partId),
      method: "DELETE",
      errorMessage: "Unable to delete the inventory item.",
    });
    return saved.ok;
  }

  async function handleCreateMaintenancePlan(planInput) {
    if (!canManageBusiness) return false;

    const customer = data.customers.find((entry) => entry.id === planInput.customerId);
    if (!customer) {
      window.alert("Select a valid customer before saving the maintenance plan.");
      return false;
    }

    const now = new Date().toISOString();
    const createdPlan = normalizeMaintenancePlanRecord({
      id: crypto.randomUUID(),
      ...canonicalMaintenancePlanInput(planInput, null, data.customers),
      createdAt: now,
      updatedAt: now,
    });

    const saved = await saveMaintenanceApiRequest({
      path: maintenancePath(),
      method: "POST",
      body: { plan: createdPlan },
      errorMessage: "Unable to create the maintenance plan.",
      throwOnError: true,
    });
    return saved.ok ? (saved.result || true) : false;
  }

  async function handleUpdateMaintenancePlan(planId, updates) {
    if (!canManageBusiness) return false;

    const existingPlan = (data.maintenancePlans || []).find((entry) => entry.id === planId);
    if (!existingPlan) return false;

    const customer = data.customers.find((entry) => entry.id === updates.customerId);
    if (!customer) {
      window.alert("Select a valid customer before saving the maintenance plan.");
      return false;
    }

    const saved = await saveMaintenanceApiRequest({
      path: maintenancePath(planId),
      method: "PATCH",
      body: { plan: { ...updates, revision: updates.revision ?? existingPlan.maintenanceRevision ?? 0 } },
      errorMessage: "Unable to save the maintenance plan.",
      throwOnError: true,
    });
    return saved.ok ? (saved.result || true) : false;
  }

  async function handleDeleteMaintenancePlan(planId) {
    if (!canManageBusiness) return false;

    const plan = (data.maintenancePlans || []).find((entry) => entry.id === planId);
    if (!plan) return false;

    const linkedJobs = data.jobs.filter((job) => job.maintenancePlanId === planId);
    const activeJobs = linkedJobs.filter((job) => job.status !== "Completed");
    const confirmed = window.confirm(
      activeJobs.length > 0
        ? `Delete ${plan.planName}? ${activeJobs.length} active maintenance job${activeJobs.length === 1 ? "" : "s"} will stay on the board, but this recurring plan will stop generating future visits.`
        : `Delete ${plan.planName} from recurring maintenance plans?`
    );
    if (!confirmed) return false;

    const saved = await saveMaintenanceApiRequest({
      path: maintenancePath(planId),
      method: "DELETE",
      errorMessage: "Unable to delete the maintenance plan.",
    });
    return saved.ok;
  }

  function handleOpenJob(job) {
    if (!job) return;
    if (match.id === "job-details" && match.params.jobId === job.id) return;
    navigate(`/jobs/${encodeURIComponent(job.id)}`, {
      replace: match.id === "job-details", state: match.id === "job-details" ? location.state : linkState,
    });
  }

  async function handleGenerateMaintenanceJob(planId, selectedOccurrence = null, { openJob = true } = {}) {
    if (!canManageBusiness) return false;

    const plan = (data.maintenancePlans || []).find((entry) => entry.id === planId);
    if (!plan) return false;

    const customer = data.customers.find((entry) => entry.id === plan.customerId);
    if (!customer) {
      window.alert("This maintenance plan is linked to a customer record that no longer exists.");
      return false;
    }

    const occurrence = selectedOccurrence || effectiveMaintenancePlan(plan, data.jobs).nextOccurrence;
    const dueDate = occurrence?.date || plan.nextDueDate || slugDate();
    const existingOpenJob = data.jobs.find((job) =>
      job.maintenancePlanId === plan.id &&
      job.maintenanceDueDate === dueDate &&
      (!selectedOccurrence || job.id === selectedOccurrence.jobId)
    );

    if (existingOpenJob) {
      if (openJob) handleOpenJob(existingOpenJob);
      return { job: existingOpenJob, duplicate: true };
    }

    const saved = await saveMaintenanceApiRequest({
      path: maintenancePath(planId, "/generate-job"),
      method: "POST",
      body: { occurrenceKey: occurrence?.key, revision: occurrence?.revision ?? plan.maintenanceRevision ?? 0 },
      errorMessage: "Unable to generate the maintenance job.",
      throwOnError: true,
    });
    if (!saved.ok) return false;
    if (openJob && saved.result?.job) {
      handleOpenJob(saved.result.job);
    }
    return saved.result || true;
  }

  const handleLoadMaintenanceOccurrences = useCallback(async (from, to, signal) => {
    const response = await fetchWithAuth(`/api/maintenance-occurrences?from=${from}&to=${to}`, { signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load maintenance dates.");
    return payload.occurrences;
  }, [fetchWithAuth]);

  async function handleRescheduleMaintenance(occurrence, date, scope) {
    const saved = await saveMaintenanceApiRequest({
      path: maintenancePath(occurrence.planId, scope === "occurrence" ? "/occurrences?response=calendar" : "/schedule"),
      method: "PATCH", throwOnError: true,
      body: { occurrenceKey: occurrence.key, nextDueDate: date, scope, revision: occurrence.revision },
    });
    return saved.ok ? { change: saved.result?.change || null } : false;
  }

  function handleOpenMaintenancePlan(planId, options = {}) {
    navigate(`/maintenance/${encodeURIComponent(planId)}${options.edit ? "/edit" : ""}`, { state: linkState });
  }

  async function handleScheduleJob(jobId, scheduledDate, { onError, recordOnly = false, completedMaintenanceCorrection = false, expectedScheduledDate } = {}) {
    if (!canManageBusiness) return false;


    const saved = await saveJobApiRequest({
      path: jobPath(jobId, recordOnly ? "/schedule?response=calendar" : "/schedule"),
      method: "PATCH",
      body: { scheduledDate: toDateInputValue(scheduledDate), ...(expectedScheduledDate !== undefined ? { expectedScheduledDate } : {}), ...(completedMaintenanceCorrection ? { completedMaintenanceCorrection: true } : {}) },
      errorMessage: "Unable to update the job schedule.",
      onError,
    });
    return saved.ok ? (recordOnly ? saved.result : true) : false;
  }

  async function calendarRescheduleRequest({ sourceDate, scheduledDate, jobs } = {}) {
    if (!canManageBusiness) throw new Error("You do not have permission to reschedule jobs.");
    const payload = await requestWorkspaceUpdate({
      fetchWithAuth,
      path: jobs ? "/api/jobs/reschedule-day" : `/api/jobs/reschedule-day?sourceDate=${encodeURIComponent(sourceDate)}`,
      method: jobs ? "POST" : "GET",
      ...(jobs ? { body: { sourceDate, scheduledDate, jobs } } : {}),
      errorMessage: jobs ? "Unable to update the job schedules." : "Unable to load the jobs for this day. Try again.",
    }).catch((failure) => {
      if (jobs) throw new Error(`Unable to confirm the move. Review the day to check the saved schedules before trying again. ${failure.message || ""}`.trim());
      throw failure;
    });
    // Reconcile only the relevant dates/records, preserving other workspace
    // state and the server's technician and imported-time fields verbatim.
    const dates = new Set([sourceDate, scheduledDate].filter(Boolean));
    const ids = new Set(jobs?.map((job) => job.id) || []);
    const serverJobs = new Map(payload.state.jobs.map((job) => [job.id, job]));
    const applyState = () => setData((previous) => {
      const affected = new Set(ids);
      for (const job of [...previous.jobs, ...serverJobs.values()]) if (dates.has(job.scheduledDate)) affected.add(job.id);
      return {
        ...previous,
        jobs: [
          ...previous.jobs.filter((job) => !affected.has(job.id)),
          ...payload.state.jobs.filter((job) => affected.has(job.id)),
        ],
      };
    });
    if (!jobs) return { ...payload.result, applyState };
    applyState();
    return payload.result;
  }

  function handlePreviewDayReschedule(sourceDate) {
    return calendarRescheduleRequest({ sourceDate });
  }

  function handleRescheduleDayJobs(operation) {
    return calendarRescheduleRequest(operation);
  }

  async function handleUndoCalendarChange(entry) {
    if (!canManageBusiness) throw new Error("Calendar Undo requires access to the job scheduling API.");
    try {
      const payload = await requestWorkspaceUpdate({ fetchWithAuth, ...calendarUndoRequest(entry), errorMessage: "Unable to undo the Calendar change. Try again." });
      applyServerState(payload.state);
      return payload.result;
    } catch (error) {
      // A conflict or a lost acknowledgement may leave different saved dates.
      // Re-read authoritative state on failure, without issuing another write.
      try {
        const payload = await requestWorkspaceUpdate({ fetchWithAuth, path: "/api/app-state", method: "GET" });
        applyServerState(payload.state);
      } catch {
        error.message += " Unable to refresh the saved schedule; check your connection and refresh before trying again.";
      }
      throw error;
    }
  }

  function getPaymentComparable(payment) {
    return {
      amount: Number(payment?.amount || 0).toFixed(2),
      date: toDateInputValue(payment?.date || payment?.paidAt || payment?.createdAt),
      method: String(payment?.method || "").trim(),
      reference: String(payment?.reference || "").trim(),
      notes: String(payment?.notes || "").trim(),
    };
  }

  function hasPaymentChanged(currentPayment, nextPayment) {
    const current = getPaymentComparable(currentPayment);
    const next = getPaymentComparable(nextPayment);
    return Object.keys(next).some((key) => current[key] !== next[key]);
  }

  function ensureStablePaymentIds(invoice) {
    return {
      ...invoice,
      payments: (invoice.payments || []).map((payment) => ({
        ...payment,
        id: payment.id || crypto.randomUUID(),
      })),
    };
  }

  async function handleAddInvoicePayment(jobId, paymentInput) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job) return false;

    const payment = {
      ...paymentInput,
      id: paymentInput?.id || crypto.randomUUID(),
    };

    const saved = await saveDocumentApiRequest({
      path: documentPath(jobId, "invoice", "/payments"),
      method: "POST",
      body: { payment },
      errorMessage: "Unable to add the invoice payment.",
    });
    return saved.ok;
  }

  async function handleEditInvoicePayment(jobId, paymentId, updates, expectedPayment) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job || !paymentId) return false;

    const existingPayment = (job.invoice?.payments || []).find((payment) => payment.id === paymentId);

    const payment = {
      ...(existingPayment || {}),
      ...updates,
      id: paymentId,
      expectedPayment: getPaymentComparable(expectedPayment || existingPayment),
    };

    const saved = await saveDocumentApiRequest({
      path: documentPath(jobId, "invoice", `/payments/${encodeURIComponent(paymentId)}`),
      method: "PATCH",
      body: { payment },
      errorMessage: "Unable to update the invoice payment.",
    });
    return saved.ok;
  }

  async function handleDeleteInvoicePayment(jobId, paymentId, expectedPayment) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job || !paymentId) return false;

    const saved = await saveDocumentApiRequest({
      path: documentPath(jobId, "invoice", `/payments/${encodeURIComponent(paymentId)}`),
      method: "DELETE",
      body: { expectedPayment: getPaymentComparable(expectedPayment || job.invoice?.payments?.find(payment => payment.id === paymentId)) },
      errorMessage: "Unable to delete the invoice payment.",
    });
    return saved.ok;
  }

  async function syncInvoicePayments(job, nextInvoice, paymentBaseline) {
    const currentInvoice = normalizeDocument("invoice", job.invoice);
    const currentPayments = paymentBaseline || currentInvoice?.payments || [];
    const nextPayments = nextInvoice.payments || [];
    const currentById = new Map(currentPayments.map((payment) => [payment.id, payment]));
    const nextById = new Map(nextPayments.map((payment) => [payment.id, payment]));

    for (const payment of currentPayments) {
      if (!nextById.has(payment.id)) {
        const deleted = await handleDeleteInvoicePayment(job.id, payment.id, payment);
        if (!deleted) return false;
      }
    }

    for (const payment of nextPayments) {
      const currentPayment = currentById.get(payment.id);
      if (!currentPayment) {
        const added = await handleAddInvoicePayment(job.id, payment);
        if (!added) return false;
      } else if (hasPaymentChanged(currentPayment, payment)) {
        const edited = await handleEditInvoicePayment(job.id, payment.id, payment, currentPayment);
        if (!edited) return false;
      }
    }

    return true;
  }

  async function handleSaveDocument(jobId, type, doc, { paymentBaseline } = {}) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job) return false;

    const documentType = type === "invoice" ? "invoice" : "quote";
    const normalizedDocument = normalizeDocument(documentType, doc);
    if (!normalizedDocument) return false;
    const documentToSave = documentType === "invoice" ? ensureStablePaymentIds(normalizedDocument) : normalizedDocument;

    const saved = await saveDocumentApiRequest({
      path: documentPath(jobId, documentType),
      method: "PUT",
      body: { [documentType]: documentToSave },
      errorMessage: `Unable to save the ${documentType}.`,
    });
    if (!saved.ok) return false;

    if (documentType === "invoice") {
      return syncInvoicePayments(job, documentToSave, paymentBaseline);
    }

    return true;
  }

  async function updateInvoiceArchive(path, method, body) {
    if (!canManageBusiness) return { ok: false, error: "You do not have permission to change invoices." };
    if (invoiceArchiveInFlightRef.current) return { ok: false, error: "An invoice update is already in progress." };
    invoiceArchiveInFlightRef.current = true;
    const fallback = "Unable to update the invoice. Please try again.";
    try {
      const response = await fetchWithAuth(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true || !payload.state) {
        return { ok: false, error: response.status >= 400 && response.status < 500 ? payload.error || fallback : fallback, code: payload.code };
      }
      applyServerState(payload.state);
      return { ok: true, result: payload.result };
    } catch {
      return { ok: false, error: fallback };
    } finally { invoiceArchiveInFlightRef.current = false; }
  }

  function handleDeleteInvoice(jobId, options = {}) {
    return updateInvoiceArchive(documentPath(jobId, "invoice"), "DELETE", { confirmSent: options.confirmSent === true });
  }

  function handleRestoreDeletedInvoice(archiveId) {
    return updateInvoiceArchive(`/api/deleted-invoices/${encodeURIComponent(archiveId)}/restore`, "POST");
  }

  async function handleDeleteDocument(jobId, type) {
    if (type === "invoice") return (await handleDeleteInvoice(jobId)).ok;
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job) return false;

    const documentType = type === "invoice" ? "invoice" : "quote";
    if (!job[documentType]) return false;

    const saved = await saveDocumentApiRequest({
      path: documentPath(jobId, documentType),
      method: "DELETE",
      errorMessage: `Unable to delete the ${documentType}.`,
    });
    return saved.ok;
  }

  async function handleUpdateInvoicePayment(jobId, updates) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job?.invoice) return false;

    const invoiceUpdates = {};
    getSupportedInvoiceUpdateKeys(updates).forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        invoiceUpdates[field] = field.endsWith("Date") ? toDateInputValue(updates[field]) : updates[field];
      }
    });

    if (Object.keys(invoiceUpdates).length === 0) {
      window.alert("This invoice change is not supported.");
      return false;
    }

    const saved = await saveDocumentApiRequest({
      path: documentPath(jobId, "invoice"),
      method: "PATCH",
      body: { invoice: invoiceUpdates },
      errorMessage: "Unable to update the invoice.",
    });
    return saved.ok;
  }

  function updateJob(jobId, changes) {
    setData((prev) => ({
      ...prev,
      jobs: prev.jobs.map((job) =>
        job.id === jobId ? { ...job, ...changes, updatedAt: new Date().toISOString() } : job
      ),
    }));
  }

  async function handleSaveServiceBoardNote(jobId, value) {
    const serviceBoardNote = normalizeServiceBoardNote(value);
    if (boardNoteSavesRef.current.has(jobId)) throw new Error("This job note is still saving. Please try again shortly.");
    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job) throw new Error("Job no longer exists.");
    const previousNote = job.serviceBoardNote ?? null;
    boardNoteSavesRef.current.add(jobId);
    const mergeNote = (note) => setData((previous) => ({
      ...previous,
      jobs: previous.jobs.map((entry) => entry.id === jobId ? { ...entry, serviceBoardNote: note } : entry),
    }));
    mergeNote(serviceBoardNote);
    try {
      const payload = await requestWorkspaceUpdate({
        fetchWithAuth,
        path: jobPath(jobId, "/service-board-note"),
        method: "PATCH",
        body: { serviceBoardNote },
        errorMessage: "Unable to save the job note.",
      });
      mergeNote(payload.result.serviceBoardNote);
    } catch (error) {
      mergeNote(previousNote);
      throw error;
    } finally {
      boardNoteSavesRef.current.delete(jobId);
    }
  }

  function confirmJobStatusChange(job, nextStatus) {
    if (job.status === "Completed" && nextStatus !== "Completed") {
      return window.confirm("Are you sure? This job has already been marked as completed.");
    }
    return true;
  }

  async function handleStatusChange(jobId, nextStatus) {
    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job || !nextStatus || job.status === nextStatus) return false;

    if (!confirmJobStatusChange(job, nextStatus)) return false;

    return queueJobStatus({
      job, nextStatus,
      save: (status, expectedStatus) => requestJobStatusUpdate({ fetchWithAuth, jobId, status, expectedStatus }),
      merge: (fields, expected) => setData((previous) => mergeJobStatusFields(previous, jobId, fields, expected)),
      onSaved: ({ maintenancePlan }) => {
        if (!maintenancePlan) return;
        setData((previous) => ({ ...previous, maintenancePlans: previous.maintenancePlans.map((plan) => {
          if (plan.id !== maintenancePlan.id || (plan.maintenanceRevision || 0) > maintenancePlan.maintenanceRevision) return plan;
          const { completedOccurrences, ...fields } = maintenancePlan;
          const completed = new Map(completedOccurrences.map((entry) => [entry.key, entry.completedAt]));
          return effectiveMaintenancePlan({ ...plan, ...fields,
            occurrenceExceptions: (plan.occurrenceExceptions || []).map((entry) => completed.has(entry.key) ? { ...entry, completedAt: completed.get(entry.key) } : entry),
          }, previous.jobs);
        }) }));
      },
      onError: (error) => window.alert(error instanceof Error ? error.message : "Unable to update the job status."),
    });
  }

  async function handlePlanJobForTomorrow(jobId) {
    if (!jobId) return false;

    const tomorrowDate = getTomorrowPlanningDate();

    const saved = await saveJobApiRequest({
      path: jobPath(jobId, "/tomorrow"),
      method: "POST",
      body: { tomorrowDate },
      errorMessage: "Unable to add the job to tomorrow.",
    });
    return saved.ok;
  }

  async function handleRemoveJobFromTomorrow(jobId) {
    if (!jobId) return false;

    const saved = await saveJobApiRequest({
      path: jobPath(jobId, "/tomorrow"),
      method: "DELETE",
      errorMessage: "Unable to remove the job from tomorrow.",
    });
    return saved.ok;
  }

  async function handleRemoveAllJobsFromTomorrow() {
    const tomorrowDate = getTomorrowPlanningDate();
    const plannedJobCount = data.jobs.filter((entry) => entry.serviceBoardTomorrowDate === tomorrowDate).length;
    if (plannedJobCount === 0) return false;

    const confirmed = window.confirm(
      `Remove all ${plannedJobCount} job${plannedJobCount === 1 ? "" : "s"} from tomorrow?`
    );
    if (!confirmed) return false;

    const saved = await saveJobApiRequest({
      path: "/api/jobs/tomorrow",
      method: "DELETE",
      body: { tomorrowDate },
      errorMessage: "Unable to clear tomorrow's plan.",
    });
    return saved.ok;
  }

  async function handleUpdateJobDetails(jobId, updates) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job) return false;

    const isStatusChanging = Boolean(updates.status && updates.status !== job.status);
    if (isStatusChanging) {
      if (!confirmJobStatusChange(job, updates.status)) return false;
    }

    const nextUpdates = { ...updates };
    if (Object.prototype.hasOwnProperty.call(nextUpdates, "scheduledDate")) {
      nextUpdates.scheduledDate = toDateInputValue(nextUpdates.scheduledDate);
    }
    if (Object.prototype.hasOwnProperty.call(nextUpdates, "ocNumber")) {
      nextUpdates.ocNumber = String(nextUpdates.ocNumber || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(nextUpdates, "requesterContact")) {
      nextUpdates.requesterContact = normalizeJobContactSnapshot(nextUpdates.requesterContact, "Requester");
    }
    if (Object.prototype.hasOwnProperty.call(nextUpdates, "onsiteContact")) {
      nextUpdates.onsiteContact = normalizeJobContactSnapshot(nextUpdates.onsiteContact, "On-site contact");
    }
    if (Object.prototype.hasOwnProperty.call(nextUpdates, "billingContact")) {
      nextUpdates.billingContact = normalizeJobContactSnapshot(nextUpdates.billingContact, "Billing contact");
    }

    const saved = await saveJobApiRequest({
      path: jobPath(jobId),
      method: "PATCH",
      body: { job: nextUpdates },
      errorMessage: "Unable to save the job details.",
    });
    if (!saved.ok) return false;

    return true;
  }

  async function handleDeleteJob(jobId) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job) return false;

    const confirmed = window.confirm(
      `Delete Job #${job.jobNumber}? This will remove the job, saved quote/invoice data, notes, and photos.`
    );
    if (!confirmed) return false;

    const saved = await saveJobApiRequest({
      path: jobPath(jobId),
      method: "DELETE",
      errorMessage: "Unable to delete the job.",
    });
    if (!saved.ok) return false;
    return true;
  }

  async function handleAddJobNote(jobId, text, author = "") {
    if (!jobId) return false;
    const noteText = String(text || "").trim();
    if (!noteText) return false;

    const saved = await saveJobApiRequest({
      path: jobPath(jobId, "/notes"),
      method: "POST",
      body: {
        note: {
          text: noteText,
          author,
        },
      },
      errorMessage: "Unable to add the job note.",
    });
    return saved.ok;
  }

  async function handleAddJobPhotos(jobId, photos = []) {
    if (!jobId) return false;
    const nextPhotos = Array.isArray(photos) ? photos.filter(Boolean) : [];
    if (nextPhotos.length === 0) return false;

    for (const photo of nextPhotos) {
      const saved = await saveJobApiRequest({
        path: jobPath(jobId, "/photos"),
        method: "POST",
        body: { photo },
        errorMessage: "Unable to add the job photo.",
      });
      if (!saved.ok) return false;
    }
    return true;
  }

  async function handleDeleteJobPhoto(jobId, photo) {
    if (!jobId || !photo?.id) return false;

    const saved = await saveJobApiRequest({
      path: jobPath(jobId, `/photos/${encodeURIComponent(photo.id)}`),
      method: "DELETE",
      errorMessage: "Unable to delete the job photo.",
    });
    return saved.ok;
  }

  function handleOpenCustomerProfile(customerId) {
    if (!canManageBusiness) return;
    return navigate(`/customers/${encodeURIComponent(customerId)}`, { state: linkState });
  }

  function handleOpenSiteProfile(customerId, siteKey) {
    if (!canManageBusiness) return;
    const normalizedSiteKey = String(siteKey || "").trim();
    if (!customerId || !normalizedSiteKey) return;
    const customer = data.customers.find((entry) => entry.id === customerId);
    const savedSite = customer?.sites?.find((site) => site.id === normalizedSiteKey
      || normalizeSiteAddress(site.address).toLowerCase() === normalizedSiteKey.toLowerCase());
    return navigate(`/customers/${encodeURIComponent(customerId)}/sites/${encodeURIComponent(savedSite?.id || normalizedSiteKey)}`, { state: linkState });
  }

  function handleCreateSiteProfile(customerId) {
    if (!canManageBusiness || !customerId) return;
    return navigate(`/customers/${encodeURIComponent(customerId)}/sites/new`, { state: linkState });
  }

  async function handleCreateCustomer(customerInput) {
    if (!canManageBusiness) return null;

    const { primarySiteType = "", primaryOcNumber = "", primarySiteAddress = {}, ...customerFields } = customerInput || {};
    const createdAt = new Date().toISOString();
    const primaryAddress = normalizeSiteAddress(customerFields.address);
    const nextSites = primaryAddress
      ? [
          normalizeSiteProfileRecord({
            id: crypto.randomUUID(),
            address: primaryAddress,
            ...siteAddressMetadata(primarySiteAddress),
            siteType: primarySiteType,
            ocNumber: primaryOcNumber,
            createdAt,
            updatedAt: createdAt,
          }),
        ].filter(Boolean)
      : [];

    const createdCustomer = normalizeCustomerRecord({
      id: crypto.randomUUID(),
      ...customerFields,
      sites: nextSites,
      createdAt,
    });

    const saved = await saveCustomerApiRequest({
      path: "/api/customers",
      method: "POST",
      body: { customer: createdCustomer },
      errorMessage: "Unable to create the customer.",
    });
    if (!saved.ok) return null;

    const savedCustomer = saved.result || createdCustomer;
    return savedCustomer;
  }

  async function handleSaveSiteProfile(customerId, siteInput, previousAddress = "") {
    if (!canManageBusiness) return false;

    const normalizedPreviousAddress = normalizeSiteAddress(previousAddress);
    const normalizedSite = normalizeSiteProfileRecord({ ...siteInput, _inferredProfile: false });
    if (!normalizedSite) return false;

    const customer = data.customers.find((entry) => entry.id === customerId);
    if (!customer) {
      window.alert("Customer not found.");
      return false;
    }

    const previousAddressKey = normalizedPreviousAddress.toLowerCase();
    const existingSite = (customer.sites || []).find((site) =>
      site.id === normalizedSite.id
      || (previousAddressKey && normalizeSiteAddress(site.address).toLowerCase() === previousAddressKey)
    );
    const siteForSave = {
      ...normalizedSite,
      ...updatedSiteAddressMetadata(existingSite, normalizedSite),
      id: existingSite?.id || normalizedSite.id,
    };
    const saved = await saveCustomerApiRequest({
      path: existingSite
        ? customerPath(customerId, `/sites/${encodeURIComponent(existingSite.id)}`)
        : customerPath(customerId, "/sites"),
      method: existingSite ? "PATCH" : "POST",
      body: {
        site: siteForSave,
        previousAddress: normalizedPreviousAddress,
      },
      errorMessage: "Unable to save the site profile.",
    });
    if (!saved.ok) return false;

    const savedSite = saved.result || siteForSave;
    return savedSite;
  }

  async function handleDeleteSiteProfile(customerId, site) {
    if (!canManageBusiness || !site) return false;

    const confirmed = window.confirm(
      site.jobCount > 0 || site.isPrimary
        ? "Remove the saved site profile? Jobs at this address will stay, but the site-specific profile details will be cleared."
        : "Delete this saved site profile?"
    );
    if (!confirmed) return false;

    const siteId = site.siteProfileId || site.id;
    if (!siteId) {
      window.alert("Site profile not found.");
      return false;
    }

    const saved = await saveCustomerApiRequest({
      path: customerPath(customerId, `/sites/${encodeURIComponent(siteId)}`),
      method: "DELETE",
      errorMessage: "Unable to delete the site profile.",
    });
    if (!saved.ok) return false;

    return true;
  }

  function handleOpenDoc(job, type) {
    if (!canManageBusiness) return;
    if (!job?.id || !["quote", "invoice"].includes(type)) return false;
    return navigate(`/jobs/${encodeURIComponent(job.id)}/${type}`, { state: match.handle?.documentType ? location.state : linkState });
  }

  function getDocumentTemplateSnapshot(type) {
    return buildTemplateWithBusinessDetails(
      type === "invoice" ? data.invoiceTemplate : data.quoteTemplate,
      themeSettings,
      type
    );
  }

  function buildDocumentJobSnapshot(job) {
    return {
      id: job.id,
      jobNumber: job.jobNumber,
      title: job.title,
      description: job.description,
      urgency: job.urgency,
      status: job.status,
      scheduledDate: job.scheduledDate,
      customerId: job.customerId,
      customerName: job.customerName,
      customerEmail: job.customerEmail,
      customerPhone: job.customerPhone,
      jobAddress: job.jobAddress,
      ocNumber: job.ocNumber || "",
      ...(Object.hasOwn(job, "siteSnapshot") ? { siteSnapshot: job.siteSnapshot } : {}),
      requesterContact: job.requesterContact || null,
      onsiteContact: job.onsiteContact || null,
      billingContact: job.billingContact || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  function getPriorDocumentSendAttempts(job, type) {
    if (!job || !type) return 0;

    return data.jobs.reduce((count, entry) => {
      if (entry.customerId !== job.customerId) return count;
      return count + (entry[type]?.sentHistory?.length || 0);
    }, 0);
  }

  async function handlePreviewDocument(doc, options = {}) {
    if (!canManageBusiness || !selectedFreshJob) return null;

    const documentLabel = docType === "invoice" ? "invoice" : "quote";
    const recipientEmail = getDocumentRecipientEmail(selectedFreshJob);
    const recipientName = getDocumentRecipientName(selectedFreshJob);
    const template = getDocumentTemplateSnapshot(docType);
    const response = await fetch("/api/quotes/preview-pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildDocumentPdfPayload({
        documentType: docType,
        job: withDocumentSiteSnapshot(selectedFreshJob, data.customers, docType),
        document: doc,
        template,
        stampText: options.stampText || "",
      })),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Unable to render the ${documentLabel} PDF preview.`);
    }

    const pdfBlob = await response.blob();
    return {
      previewUrl: URL.createObjectURL(pdfBlob),
      documentLabel,
      toEmail: recipientEmail,
      toName: recipientName,
      fromEmail: themeSettings.defaultSenderEmail || ADMIN_EMAIL,
      replyToEmail: themeSettings.replyToEmail || themeSettings.defaultSenderEmail || ADMIN_EMAIL,
      ccEmail: docType === "invoice" ? themeSettings.invoiceCcEmail : themeSettings.quoteCcEmail,
      email: createDocumentEmailDraft({
        job: selectedFreshJob, type: docType, emailPurpose: options.emailPurpose || "",
        emailSettings: { ccEmail: docType === "invoice" ? themeSettings.invoiceCcEmail : themeSettings.quoteCcEmail, signature: themeSettings.emailSignature },
      }),
      contactSuggestions: documentContactSuggestions(selectedFreshJob, data.customers.find((customer) => customer.id === selectedFreshJob.customerId)),
      priorAttempts: getPriorDocumentSendAttempts(selectedFreshJob, docType),
      stampText: options.stampText || "",
      emailPurpose: options.emailPurpose || "",
    };
  }

  async function handleOpenSentDocumentCopy(job, type) {
    if (!canManageBusiness || !job) return;

    const documentLabel = type === "invoice" ? "invoice" : "quote";
    const currentDocument = normalizeDocument(type, job[type]);
    const sentHistory = Array.isArray(currentDocument?.sentHistory) ? currentDocument.sentHistory : [];
    const latestSentEntry = sentHistory.at(-1) || null;

    if (!currentDocument || !latestSentEntry) {
      window.alert(`No sent ${documentLabel} copy is available yet.`);
      return;
    }

    const popup = window.open("about:blank", "_blank");
    if (popup) {
      popup.opener = null;
      popup.document.title = `Opening ${documentLabel}...`;
      popup.document.body.innerHTML = `<p style="font-family: sans-serif; padding: 24px;">Opening ${documentLabel} PDF...</p>`;
    }

    try {
      const documentSnapshot = normalizeDocument(
        type,
        latestSentEntry.documentSnapshot || latestSentEntry.document || currentDocument
      );
      const templateSnapshot = type === "invoice"
        ? normalizeInvoiceTemplate(latestSentEntry.templateSnapshot || getDocumentTemplateSnapshot(type))
        : normalizeQuoteTemplate(latestSentEntry.templateSnapshot || getDocumentTemplateSnapshot(type));
      const jobSnapshot = {
        ...job,
        ...(latestSentEntry.jobSnapshot || {}),
      };
      const response = await fetch("/api/quotes/preview-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildDocumentPdfPayload({
          documentType: type,
          job: jobSnapshot,
          document: documentSnapshot,
          template: templateSnapshot,
          stampText: latestSentEntry.stampText || "",
        })),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Unable to open the sent ${documentLabel} PDF.`);
      }

      const pdfBlob = await response.blob();
      const previewUrl = URL.createObjectURL(pdfBlob);

      if (popup && !popup.closed) {
        popup.location.href = previewUrl;
      } else {
        window.open(previewUrl, "_blank", "noopener,noreferrer");
      }

      window.setTimeout(() => URL.revokeObjectURL(previewUrl), 1000 * 60);
    } catch (error) {
      if (popup && !popup.closed) {
        popup.close();
      }
      const message = error instanceof Error ? error.message : `Unable to open the sent ${documentLabel} PDF.`;
      window.alert(message);
    }
  }

  async function handleSendDocument(doc, options = {}) {
    if (!canManageBusiness || !selectedFreshJob) return false;
    if (documentSendInFlightRef.current) return { status: "pending" };
    const recipientEmail = getDocumentRecipientEmail(selectedFreshJob);
    const recipientName = getDocumentRecipientName(selectedFreshJob);
    documentSendInFlightRef.current = true;
    setIsSendingDocument(true);
    try {
      const template = getDocumentTemplateSnapshot(docType);
      const documentJob = withDocumentSiteSnapshot(selectedFreshJob, data.customers, docType);
      const requestHeaders = {
        "Content-Type": "application/json",
      };
      return await sendDocumentAndPersistHistory({
        sendEmail: async () => {
          const response = await fetch("/api/documents/send", {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify({ ...buildDocumentPdfPayload({
              job: documentJob,
              documentType: docType,
              document: doc,
              template,
              stampText: options.stampText || "",
              emailPurpose: options.emailPurpose || "",
              emailSettings: {
                fromEmail: themeSettings.defaultSenderEmail,
                replyToEmail: themeSettings.replyToEmail,
                ccEmail: docType === "invoice" ? themeSettings.invoiceCcEmail : themeSettings.quoteCcEmail,
                signature: themeSettings.emailSignature,
              },
            }), ...(options.email !== undefined ? { email: options.email } : {}) }),
          }).catch(() => { throw Object.assign(new Error("Email response unavailable."), { code: "SEND_UNCONFIRMED" }); });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload.ok !== true) {
            throw Object.assign(new Error("Email acceptance was not confirmed."), {
              code: response.ok ? "SEND_UNCONFIRMED" : payload.code || "SEND_FAILED",
              delivery: payload.delivery,
              fieldErrors: payload.fieldErrors,
            });
          }

          return payload;
        },
        buildHistoryEntry: (payload) => ({
          id: crypto.randomUUID(),
          sentAt: payload.sentAt || new Date().toISOString(),
          fromEmail: payload.fromEmail || ADMIN_EMAIL,
          toEmail: recipientList(payload.to).join(", ") || payload.recipientEmail || recipientEmail,
          toName: recipientName,
          subject: payload.subject || "",
          messageId: payload.messageId || "",
          // Additional metadata round-trips through document_send_history.extra_json.
          to: payload.to,
          cc: payload.cc,
          bcc: payload.bcc,
          replyToEmail: payload.replyToEmail,
          message: payload.message,
          acceptedRecipients: payload.acceptedRecipients,
          rejectedRecipients: payload.rejectedRecipients,
          unconfirmedRecipients: payload.unconfirmedRecipients,
          warning: payload.warning || "",
          sentBy: payload.sentBy,
          stampText: options.stampText || "",
          emailPurpose: options.emailPurpose || "",
          jobSnapshot: buildDocumentJobSnapshot(documentJob),
          documentSnapshot: normalizeDocument(docType, { ...doc, sentHistory: [] }),
          templateSnapshot: template,
        }),
        persistHistory: async ({ historyEntry }) => {
          const savedDocument = await handleSaveDocument(selectedFreshJob.id, docType, doc);
          if (!savedDocument) return false;

          const savedHistory = await saveDocumentApiRequest({
            path: documentPath(selectedFreshJob.id, docType, "/sent-history"),
            method: "POST",
            body: { history: historyEntry },
            errorMessage: `Email was sent, but the ${docType} send history could not be saved.`,
          });
          return savedHistory.ok;
        },
      });
    } finally {
      documentSendInFlightRef.current = false;
      setIsSendingDocument(false);
    }
  }

  async function handleUpdateCustomer(customerId, updates) {
    if (!canManageBusiness) return false;

    const saved = await saveCustomerApiRequest({
      path: customerPath(customerId),
      method: "PATCH",
      body: { customer: updates },
      errorMessage: "Unable to save the customer.",
    });
    return saved.ok ? (saved.result || true) : false;
  }

  async function handleDeleteCustomer(customerId) {
    if (!canManageBusiness) return false;

    const customer = data.customers.find((entry) => entry.id === customerId);
    if (!customer) return false;

    const relatedJobs = data.jobs.filter((job) => job.customerId === customerId);
    const relatedMaintenancePlans = (data.maintenancePlans || []).filter((plan) => plan.customerId === customerId);
    const confirmed = window.confirm(
      relatedJobs.length > 0 || relatedMaintenancePlans.length > 0
        ? `Delete ${customer.name} and ${relatedJobs.length} related job${relatedJobs.length === 1 ? "" : "s"}${relatedMaintenancePlans.length > 0 ? ` plus ${relatedMaintenancePlans.length} maintenance plan${relatedMaintenancePlans.length === 1 ? "" : "s"}` : ""}? This will also remove linked quotes, invoices, notes, and photos.`
        : `Delete ${customer.name} from the customer database?`
    );
    if (!confirmed) return false;

    const saved = await saveCustomerApiRequest({
      path: customerPath(customerId),
      method: "DELETE",
      errorMessage: "Unable to delete the customer.",
    });
    if (!saved.ok) return false;

    return true;
  }

  async function handleRestoreDeletedJob(jobId) {
    if (!canManageBusiness) return false;

    const saved = await saveJobApiRequest({
      path: jobPath(jobId, "/restore"),
      method: "POST",
      errorMessage: "Unable to restore the job.",
    });
    return saved.ok;
  }

  async function handleRestoreDeletedCustomer(customerId) {
    if (!canManageBusiness) return false;

    const saved = await saveCustomerApiRequest({
      path: customerPath(customerId, "/restore"),
      method: "POST",
      errorMessage: "Unable to restore the customer.",
    });
    return saved.ok;
  }

  async function handleEmptyDeletedJobs() {
    if (!canManageBusiness) return false;
    if (data.deletedJobs.length === 0) return false;
    const confirmed = window.confirm("Empty the deleted jobs recycle bin? This cannot be undone.");
    if (!confirmed) return false;

    const saved = await saveJobApiRequest({
      path: "/api/deleted-jobs",
      method: "DELETE",
      errorMessage: "Unable to empty deleted jobs.",
    });
    return saved.ok;
  }

  async function handleEmptyDeletedCustomers() {
    if (!canManageBusiness) return false;
    if (data.deletedCustomers.length === 0) return false;
    const confirmed = window.confirm("Empty the deleted customers recycle bin? This cannot be undone.");
    if (!confirmed) return false;

    const saved = await saveCustomerApiRequest({
      path: "/api/deleted-customers",
      method: "DELETE",
      errorMessage: "Unable to empty deleted customers.",
    });
    return saved.ok;
  }

  async function handleWorkspaceLogoChange(file) {
    if (!canManageBusiness) throw new Error("Workspace branding is not available for this account or storage mode.");
    const response = await fetchWithAuth("/api/settings/workspace-logo", file
      ? { method: "PUT", headers: { "Content-Type": file.type }, body: file }
      : { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to save the workspace logo.");
    setData((previous) => ({ ...previous, settings: { ...previous.settings, workspaceLogoUrl: payload.workspaceLogoUrl } }));
    return payload.workspaceLogoUrl;
  }

  return {
    handleWorkspaceLogoChange,
    createJob,
    handleAddInvoicePayment,
    handleAddJobNote,
    handleAddJobPhotos,
    handleCreateCustomer,
    handleCreateInventoryItem,
    handleCreateMaintenancePlan,
    handleCreateStaff,
    handleCreateSiteProfile,
    handleDeleteCustomer,
    handleDeleteDocument,
    handleDeleteInvoice,
    handleRestoreDeletedInvoice,
    handleDeleteInventoryItem,
    handleDeleteInvoicePayment,
    handleDeleteJob,
    handleDeleteJobPhoto,
    handleDeleteMaintenancePlan,
    handleDeleteSiteProfile,
    handleEmptyDeletedCustomers,
    handleEmptyDeletedJobs,
    handleEditInvoicePayment,
    handleGenerateMaintenanceJob,
    handleLoadMaintenanceOccurrences,
    handleRescheduleMaintenance,
    handleOpenMaintenancePlan,
    handleOpenCustomerProfile,
    handleOpenDoc,
    handlePreviewDocument,
    handleOpenSentDocumentCopy,
    handleOpenJob,
    handlePlanJobForTomorrow,
    handleOpenSiteProfile,
    handleRemoveAllJobsFromTomorrow,
    handleRemoveJobFromTomorrow,
    handleRestoreDeletedCustomer,
    handleRestoreDeletedJob,
    handleSaveDocument,
    handleSaveSiteProfile,
    handleScheduleJob,
    handlePreviewDayReschedule,
    handleRescheduleDayJobs,
    handleUndoCalendarChange,
    handleSendDocument,
    handleStatusChange,
    handleUpdateCustomer,
    handleUpdateInventoryItem,
    handleUpdateInvoicePayment,
    handleUpdateJobDetails,
    handleUpdateMaintenancePlan,
    handleUpdateStaff,
    updateJob,
    handleSaveServiceBoardNote,
  };
}
