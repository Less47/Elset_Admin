import {
  addDaysToDateInput,
  buildContactSnapshot,
  buildMaintenanceJobDescription,
  defaultThemeSettings,
  getCustomerBillingContact,
  getNextJobNumber,
  getNextMaintenanceDueDate,
  getCustomerSitePrimaryContact,
  normalizeCustomerRecord,
  normalizeCustomerSiteProfiles,
  normalizeDocument,
  normalizeInventoryRecord,
  normalizeJobRecord,
  normalizeJobContactSnapshot,
  normalizeMaintenancePlanRecord,
  normalizeSiteAccessNotes,
  normalizeSiteAddress,
  normalizeSiteProfileRecord,
  normalizeStaffRecord,
  normalizeThemeSettings,
  pickSettings,
  preferenceSettingKeys,
  slugDate,
  syncJobWithCustomer,
  toDateInputValue,
  uiSettingKeys,
} from "@/lib/app-support";
import {
  ADMIN_EMAIL,
  buildTemplateWithBusinessDetails,
  defaultInvoiceTemplate,
  defaultQuoteTemplate,
  getDocumentRecipientEmail,
  getDocumentRecipientName,
  normalizeDocumentTemplate,
  normalizeInvoiceTemplate,
  normalizeQuoteTemplate,
} from "@/lib/quote-template";
import {
  isSqliteWorkspaceMode,
  requestCustomerWorkspaceUpdate,
  requestDocumentWorkspaceUpdate,
  requestInventoryWorkspaceUpdate,
  requestMaintenanceWorkspaceUpdate,
  requestSettingsWorkspaceUpdate,
  requestStaffWorkspaceUpdate,
  requestWorkspaceUpdate,
} from "./workspace-customer-api";
import { sendDocumentAndPersistHistory } from "./document-send-workflow";
import { getSupportedInvoiceUpdateKeys } from "./workspace-invoice-updates";

export function useWorkspaceActions({
  applyServerWorkspaceState,
  canManageBusiness,
  data,
  docType,
  fetchWithAuth,
  onCloseJobWorkspace,
  onNavigateToJob,
  selectedFreshJob,
  selectedJob,
  selectedSiteContext,
  setCustomerProfileOpen,
  setData,
  setDocEditorOpen,
  setDocType,
  setIsSendingDocument,
  setSelectedCustomerId,
  setSelectedJob,
  setSelectedSiteContext,
  setSiteProfileOpen,
  themeSettings,
  workspaceStorageMode = "json",
}) {
  const useSqliteApi = isSqliteWorkspaceMode(workspaceStorageMode);
  const useCustomerSqliteApi = useSqliteApi;

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
      window.alert(error instanceof Error ? error.message : errorMessage);
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
      window.alert(error instanceof Error ? error.message : errorMessage);
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

  async function saveSettingsApiRequest({
    path,
    method = "POST",
    body,
    errorMessage = "Unable to update workspace settings.",
  }) {
    try {
      const payload = await requestSettingsWorkspaceUpdate({
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

  function documentTemplatePath(type, suffix = "") {
    const templateType = type === "invoice" ? "invoice" : "quote";
    return `/api/document-templates/${templateType}${suffix}`;
  }

  function getTomorrowPlanningDate() {
    return addDaysToDateInput(toDateInputValue(new Date()), 1);
  }

  function getNextTomorrowPlanningOrder(jobs, tomorrowDate) {
    return jobs.reduce((maxOrder, job) => {
      if (job.serviceBoardTomorrowDate !== tomorrowDate) return maxOrder;

      const nextOrder = Number.isFinite(Number(job.serviceBoardTomorrowOrder))
        ? Number(job.serviceBoardTomorrowOrder)
        : 0;

      return Math.max(maxOrder, nextOrder);
    }, 0) + 1;
  }

  async function createJob({ job, customerMode, customer, siteInput = null }) {
    if (!canManageBusiness) return;

    if (useSqliteApi) {
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

    let customerRecord = customer;
    let customers = data.customers;
    const now = new Date().toISOString();
    const normalizedSiteInput = siteInput
      ? normalizeSiteProfileRecord({
          ...siteInput,
          updatedAt: now,
          createdAt: siteInput.createdAt || now,
        })
      : null;

    if (customerMode === "new") {
      customerRecord = normalizeCustomerRecord({
        id: crypto.randomUUID(),
        ...customer,
        address: normalizedSiteInput?.address || "",
        sites: normalizedSiteInput ? [normalizedSiteInput] : [],
        createdAt: now,
      });
      customers = [...data.customers, customerRecord];
    } else if (customer?.id) {
      const existingCustomer = data.customers.find((entry) => entry.id === customer.id) || customer;

      if (normalizedSiteInput) {
        customerRecord = normalizeCustomerRecord({
          ...existingCustomer,
          sites: normalizeCustomerSiteProfiles(
            [
              ...normalizeCustomerSiteProfiles(existingCustomer.sites, existingCustomer.address, existingCustomer.siteAccessNotes).filter(
                (site) => site.address.toLowerCase() !== normalizedSiteInput.address.toLowerCase()
              ),
              normalizedSiteInput,
            ],
            existingCustomer.address,
            []
          ),
          createdAt: existingCustomer.createdAt,
        });
        customers = data.customers.map((entry) => (entry.id === customerRecord.id ? customerRecord : entry));
      } else {
        customerRecord = existingCustomer;
      }
    }

    const jobAddress = normalizeSiteAddress(job.jobAddress || normalizedSiteInput?.address || customerRecord.address);
    const billingContact = buildContactSnapshot(job.billingContact, "Billing contact")
      || buildContactSnapshot(getCustomerBillingContact(customerRecord), "Billing contact");
    const onsiteContact = buildContactSnapshot(job.onsiteContact, "On-site contact")
      || buildContactSnapshot(getCustomerSitePrimaryContact(customerRecord, jobAddress), "On-site contact");
    const requesterContact = buildContactSnapshot(job.requesterContact, "Requester");

    const newJob = normalizeJobRecord({
      id: crypto.randomUUID(),
      jobNumber: getNextJobNumber(data.jobs),
      title: job.title,
      description: job.description,
      urgency: job.urgency,
      status: "To Do",
      scheduledDate: toDateInputValue(job.scheduledDate),
      assignedTechnicianId: job.assignedTechnicianId || "",
      assignedTechnicianName: job.assignedTechnicianName || "",
      customerId: customerRecord.id,
      customerName: customerRecord.name,
      customerEmail: customerRecord.email || billingContact?.email || "",
      customerPhone: customerRecord.phone || billingContact?.phone || "",
      jobAddress,
      ocNumber: String(job.ocNumber || normalizedSiteInput?.ocNumber || "").trim(),
      requesterContact,
      onsiteContact,
      billingContact,
      createdAt: now,
      updatedAt: now,
      notes: [],
      photos: [],
      quote: null,
      invoice: null,
    });

    setData({
      ...data,
      customers,
      jobs: [newJob, ...data.jobs],
    });
    return newJob;
  }

  async function handleCreateStaff(staffInput) {
    if (!canManageBusiness) return null;

    if (useSqliteApi) {
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

    const createdStaff = normalizeStaffRecord({
      id: crypto.randomUUID(),
      ...staffInput,
      createdAt: new Date().toISOString(),
    });

    setData((prev) => ({
      ...prev,
      staff: [createdStaff, ...prev.staff.filter((entry) => entry.id !== createdStaff.id)],
    }));

    return createdStaff;
  }

  async function handleUpdateStaff(staffId, updates) {
    if (!canManageBusiness) return null;

    if (useSqliteApi) {
      const saved = await saveStaffApiRequest({
        path: staffPath(staffId),
        method: "PATCH",
        body: { staff: updates },
        errorMessage: "Unable to save the staff member.",
      });
      return saved.ok ? saved.result : null;
    }

    const updatedStaff = normalizeStaffRecord({
      ...(data.staff.find((entry) => entry.id === staffId) || {}),
      ...updates,
    });

    setData((prev) => {
      const staff = prev.staff.map((entry) => (
        entry.id === staffId
          ? updatedStaff
          : entry
      ));

      return {
        ...prev,
        staff,
      };
    });

    return updatedStaff;
  }

  async function handleCreateInventoryItem(partInput) {
    if (!canManageBusiness) return false;

    const createdPart = normalizeInventoryRecord({
      id: crypto.randomUUID(),
      ...partInput,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    if (useSqliteApi) {
      const saved = await saveInventoryApiRequest({
        path: inventoryPath(),
        method: "POST",
        body: { item: createdPart },
        errorMessage: "Unable to create the inventory item.",
      });
      return saved.ok ? (saved.result || true) : false;
    }

    setData((prev) => ({
      ...prev,
      inventoryItems: [createdPart, ...(prev.inventoryItems || []).filter((entry) => entry.id !== createdPart.id)],
    }));

    return true;
  }

  async function handleUpdateInventoryItem(partId, updates) {
    if (!canManageBusiness) return false;

    if (useSqliteApi) {
      const saved = await saveInventoryApiRequest({
        path: inventoryPath(partId),
        method: "PATCH",
        body: { item: updates },
        errorMessage: "Unable to save the inventory item.",
      });
      return saved.ok ? (saved.result || true) : false;
    }

    setData((prev) => ({
      ...prev,
      inventoryItems: (prev.inventoryItems || []).map((part) =>
        part.id === partId
          ? normalizeInventoryRecord({ ...part, ...updates, updatedAt: new Date().toISOString() })
          : part
      ),
    }));

    return true;
  }

  async function handleDeleteInventoryItem(partId) {
    if (!canManageBusiness) return false;

    const part = (data.inventoryItems || []).find((entry) => entry.id === partId);
    if (!part) return false;

    const confirmed = window.confirm(`Delete ${part.name} from parts inventory?`);
    if (!confirmed) return false;

    if (useSqliteApi) {
      const saved = await saveInventoryApiRequest({
        path: inventoryPath(partId),
        method: "DELETE",
        errorMessage: "Unable to delete the inventory item.",
      });
      return saved.ok;
    }

    setData((prev) => ({
      ...prev,
      inventoryItems: (prev.inventoryItems || []).filter((entry) => entry.id !== partId),
    }));

    return true;
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
      ...planInput,
      createdAt: now,
      updatedAt: now,
    });

    if (useSqliteApi) {
      const saved = await saveMaintenanceApiRequest({
        path: maintenancePath(),
        method: "POST",
        body: { plan: createdPlan },
        errorMessage: "Unable to create the maintenance plan.",
      });
      return saved.ok ? (saved.result || true) : false;
    }

    setData((prev) => ({
      ...prev,
      maintenancePlans: [createdPlan, ...(prev.maintenancePlans || []).filter((entry) => entry.id !== createdPlan.id)],
    }));

    return true;
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

    if (useSqliteApi) {
      const saved = await saveMaintenanceApiRequest({
        path: maintenancePath(planId),
        method: "PATCH",
        body: { plan: updates },
        errorMessage: "Unable to save the maintenance plan.",
      });
      return saved.ok ? (saved.result || true) : false;
    }

    setData((prev) => ({
      ...prev,
      maintenancePlans: (prev.maintenancePlans || []).map((plan) =>
        plan.id === planId
          ? normalizeMaintenancePlanRecord({
              ...plan,
              ...updates,
              updatedAt: new Date().toISOString(),
            })
          : plan
      ),
    }));

    return true;
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

    if (useSqliteApi) {
      const saved = await saveMaintenanceApiRequest({
        path: maintenancePath(planId),
        method: "DELETE",
        errorMessage: "Unable to delete the maintenance plan.",
      });
      return saved.ok;
    }

    setData((prev) => ({
      ...prev,
      maintenancePlans: (prev.maintenancePlans || []).filter((entry) => entry.id !== planId),
    }));

    return true;
  }

  function handleOpenJob(job) {
    if (!job) return;
    setCustomerProfileOpen(false);
    setSiteProfileOpen(false);
    setSelectedJob(job);
    onNavigateToJob?.(job);
  }

  async function handleGenerateMaintenanceJob(planId) {
    if (!canManageBusiness) return false;

    const plan = (data.maintenancePlans || []).find((entry) => entry.id === planId);
    if (!plan) return false;

    const customer = data.customers.find((entry) => entry.id === plan.customerId);
    if (!customer) {
      window.alert("This maintenance plan is linked to a customer record that no longer exists.");
      return false;
    }

    const dueDate = plan.nextDueDate || slugDate();
    const existingOpenJob = data.jobs.find((job) =>
      job.maintenancePlanId === plan.id &&
      job.maintenanceDueDate === dueDate &&
      job.status !== "Completed"
    );

    if (existingOpenJob) {
      handleOpenJob(existingOpenJob);
      return true;
    }

    if (useSqliteApi) {
      const saved = await saveMaintenanceApiRequest({
        path: maintenancePath(planId, "/generate-job"),
        method: "POST",
        errorMessage: "Unable to generate the maintenance job.",
      });
      if (!saved.ok) return false;
      if (saved.result?.job) {
        handleOpenJob(saved.result.job);
      }
      return saved.result || true;
    }

    const now = new Date().toISOString();
    const jobAddress = plan.siteAddress || customer.address;
    const billingContact = buildContactSnapshot(getCustomerBillingContact(customer), "Billing contact");
    const onsiteContact = buildContactSnapshot(getCustomerSitePrimaryContact(customer, jobAddress), "On-site contact");
    const newJob = normalizeJobRecord({
      id: crypto.randomUUID(),
      jobNumber: getNextJobNumber(data.jobs),
      title: plan.planName,
      description: buildMaintenanceJobDescription(plan),
      urgency: "Medium",
      status: "To Do",
      scheduledDate: dueDate,
      assignedTechnicianId: "",
      assignedTechnicianName: "",
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email || billingContact?.email || "",
      customerPhone: customer.phone || billingContact?.phone || "",
      jobAddress,
      requesterContact: null,
      onsiteContact,
      billingContact,
      maintenancePlanId: plan.id,
      maintenancePlanName: plan.planName,
      maintenanceDueDate: dueDate,
      createdAt: now,
      updatedAt: now,
      notes: [],
      photos: [],
      quote: null,
      invoice: null,
    });

    setData((prev) => ({
      ...prev,
      jobs: [newJob, ...prev.jobs],
      maintenancePlans: (prev.maintenancePlans || []).map((entry) =>
        entry.id === plan.id
          ? normalizeMaintenancePlanRecord({
              ...entry,
              lastGeneratedAt: now,
              lastGeneratedJobId: newJob.id,
              nextDueDate: getNextMaintenanceDueDate(dueDate, entry.frequency),
              updatedAt: now,
            })
          : entry
      ),
    }));

    handleOpenJob(newJob);
    return true;
  }

  async function handleScheduleJob(jobId, scheduledDate) {
    if (!canManageBusiness) return false;

    if (useSqliteApi) {
      const saved = await saveJobApiRequest({
        path: jobPath(jobId, "/schedule"),
        method: "PATCH",
        body: { scheduledDate: toDateInputValue(scheduledDate) },
        errorMessage: "Unable to update the job schedule.",
      });
      return saved.ok;
    }

    updateJob(jobId, { scheduledDate: toDateInputValue(scheduledDate) });
    return true;
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

    if (useSqliteApi) {
      const saved = await saveDocumentApiRequest({
        path: documentPath(jobId, "invoice", "/payments"),
        method: "POST",
        body: { payment },
        errorMessage: "Unable to add the invoice payment.",
      });
      return saved.ok;
    }

    if (!job.invoice) return false;

    const nextInvoice = normalizeDocument("invoice", {
      ...job.invoice,
      payments: [...(job.invoice.payments || []), payment],
    });
    updateJob(jobId, { invoice: nextInvoice });
    return true;
  }

  async function handleEditInvoicePayment(jobId, paymentId, updates) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job || !paymentId) return false;

    const existingPayment = (job.invoice?.payments || []).find((payment) => payment.id === paymentId);
    if (!existingPayment && !useSqliteApi) return false;

    const payment = {
      ...(existingPayment || {}),
      ...updates,
      id: paymentId,
    };

    if (useSqliteApi) {
      const saved = await saveDocumentApiRequest({
        path: documentPath(jobId, "invoice", `/payments/${encodeURIComponent(paymentId)}`),
        method: "PATCH",
        body: { payment },
        errorMessage: "Unable to update the invoice payment.",
      });
      return saved.ok;
    }

    const nextInvoice = normalizeDocument("invoice", {
      ...job.invoice,
      payments: (job.invoice.payments || []).map((entry) => (entry.id === paymentId ? payment : entry)),
    });
    updateJob(jobId, { invoice: nextInvoice });
    return true;
  }

  async function handleDeleteInvoicePayment(jobId, paymentId) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job || !paymentId) return false;
    if (!job.invoice && !useSqliteApi) return false;

    if (useSqliteApi) {
      const saved = await saveDocumentApiRequest({
        path: documentPath(jobId, "invoice", `/payments/${encodeURIComponent(paymentId)}`),
        method: "DELETE",
        errorMessage: "Unable to delete the invoice payment.",
      });
      return saved.ok;
    }

    const nextInvoice = normalizeDocument("invoice", {
      ...job.invoice,
      payments: (job.invoice.payments || []).filter((payment) => payment.id !== paymentId),
    });
    updateJob(jobId, { invoice: nextInvoice });
    return true;
  }

  async function syncInvoicePayments(job, nextInvoice) {
    const currentInvoice = normalizeDocument("invoice", job.invoice);
    const currentPayments = currentInvoice?.payments || [];
    const nextPayments = nextInvoice.payments || [];
    const currentById = new Map(currentPayments.map((payment) => [payment.id, payment]));
    const nextById = new Map(nextPayments.map((payment) => [payment.id, payment]));

    for (const payment of currentPayments) {
      if (!nextById.has(payment.id)) {
        const deleted = await handleDeleteInvoicePayment(job.id, payment.id);
        if (!deleted) return false;
      }
    }

    for (const payment of nextPayments) {
      const currentPayment = currentById.get(payment.id);
      if (!currentPayment) {
        const added = await handleAddInvoicePayment(job.id, payment);
        if (!added) return false;
      } else if (hasPaymentChanged(currentPayment, payment)) {
        const edited = await handleEditInvoicePayment(job.id, payment.id, payment);
        if (!edited) return false;
      }
    }

    return true;
  }

  async function handleSaveDocument(jobId, type, doc) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job) return false;

    const documentType = type === "invoice" ? "invoice" : "quote";
    const normalizedDocument = normalizeDocument(documentType, doc);
    if (!normalizedDocument) return false;
    const documentToSave = documentType === "invoice" ? ensureStablePaymentIds(normalizedDocument) : normalizedDocument;

    if (useSqliteApi) {
      const saved = await saveDocumentApiRequest({
        path: documentPath(jobId, documentType),
        method: "PUT",
        body: { [documentType]: documentToSave },
        errorMessage: `Unable to save the ${documentType}.`,
      });
      if (!saved.ok) return false;

      if (documentType === "invoice") {
        return syncInvoicePayments(job, documentToSave);
      }

      return true;
    }

    updateJob(jobId, { [documentType]: documentToSave });
    return true;
  }

  async function handleDeleteDocument(jobId, type) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job) return false;

    const documentType = type === "invoice" ? "invoice" : "quote";
    if (!job[documentType]) return false;

    if (useSqliteApi) {
      const saved = await saveDocumentApiRequest({
        path: documentPath(jobId, documentType),
        method: "DELETE",
        errorMessage: `Unable to delete the ${documentType}.`,
      });
      return saved.ok;
    }

    updateJob(jobId, { [documentType]: null });
    return true;
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

    if (useSqliteApi) {
      if (Object.keys(invoiceUpdates).length === 0) {
        window.alert("This invoice change is not supported in SQLite mode yet.");
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

    const nextInvoice = normalizeDocument("invoice", {
      ...job.invoice,
      ...updates,
    });

    updateJob(jobId, { invoice: nextInvoice });
    return true;
  }

  function updateJob(jobId, changes) {
    setData((prev) => ({
      ...prev,
      jobs: prev.jobs.map((job) =>
        job.id === jobId ? { ...job, ...changes, updatedAt: new Date().toISOString() } : job
      ),
    }));
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

    if (useSqliteApi) {
      const saved = await saveJobApiRequest({
        path: jobPath(jobId, "/status"),
        method: "PATCH",
        body: { status: nextStatus },
        errorMessage: "Unable to update the job status.",
      });
      return saved.ok;
    }

    const now = new Date().toISOString();
    const shouldClearTomorrowPlan = nextStatus === "Completed";
    setData((prev) => ({
      ...prev,
      jobs: prev.jobs.map((entry) =>
        entry.id === jobId
          ? {
              ...entry,
              status: nextStatus,
              updatedAt: now,
              ...(shouldClearTomorrowPlan
                ? {
                    serviceBoardTomorrowDate: "",
                    serviceBoardTomorrowOrder: null,
                  }
                : {}),
            }
          : entry
      ),
      maintenancePlans: nextStatus === "Completed" && job.maintenancePlanId
        ? (prev.maintenancePlans || []).map((plan) =>
            plan.id === job.maintenancePlanId
              ? normalizeMaintenancePlanRecord({ ...plan, lastCompletedAt: now, updatedAt: now })
              : plan
          )
        : prev.maintenancePlans,
    }));
    return true;
  }

  async function handlePlanJobForTomorrow(jobId) {
    if (!jobId) return false;

    const tomorrowDate = getTomorrowPlanningDate();

    if (useSqliteApi) {
      const saved = await saveJobApiRequest({
        path: jobPath(jobId, "/tomorrow"),
        method: "POST",
        body: { tomorrowDate },
        errorMessage: "Unable to add the job to tomorrow.",
      });
      return saved.ok;
    }

    setData((prev) => {
      const existingJob = prev.jobs.find((entry) => entry.id === jobId);
      if (!existingJob) return prev;
      if (existingJob.serviceBoardTomorrowDate === tomorrowDate && existingJob.scheduledDate === tomorrowDate) return prev;

      const nextOrder = getNextTomorrowPlanningOrder(prev.jobs, tomorrowDate);
      const now = new Date().toISOString();

      return {
        ...prev,
        jobs: prev.jobs.map((entry) =>
          entry.id === jobId
            ? {
                ...entry,
                serviceBoardTomorrowDate: tomorrowDate,
                serviceBoardTomorrowOrder:
                  entry.serviceBoardTomorrowDate === tomorrowDate && Number.isFinite(Number(entry.serviceBoardTomorrowOrder))
                    ? Number(entry.serviceBoardTomorrowOrder)
                    : nextOrder,
                scheduledDate: tomorrowDate,
                updatedAt: now,
              }
            : entry
        ),
      };
    });

    return true;
  }

  async function handleRemoveJobFromTomorrow(jobId) {
    if (!jobId) return false;

    if (useSqliteApi) {
      const saved = await saveJobApiRequest({
        path: jobPath(jobId, "/tomorrow"),
        method: "DELETE",
        errorMessage: "Unable to remove the job from tomorrow.",
      });
      return saved.ok;
    }

    setData((prev) => {
      const existingJob = prev.jobs.find((entry) => entry.id === jobId);
      if (!existingJob?.serviceBoardTomorrowDate) return prev;
      const now = new Date().toISOString();

      return {
        ...prev,
        jobs: prev.jobs.map((entry) =>
          entry.id === jobId
            ? {
                ...entry,
                serviceBoardTomorrowDate: "",
                serviceBoardTomorrowOrder: null,
                scheduledDate: "",
                updatedAt: now,
              }
            : entry
        ),
      };
    });

    return true;
  }

  async function handleRemoveAllJobsFromTomorrow() {
    const tomorrowDate = getTomorrowPlanningDate();
    const plannedJobCount = data.jobs.filter((entry) => entry.serviceBoardTomorrowDate === tomorrowDate).length;
    if (plannedJobCount === 0) return false;

    const confirmed = window.confirm(
      `Remove all ${plannedJobCount} job${plannedJobCount === 1 ? "" : "s"} from tomorrow?`
    );
    if (!confirmed) return false;

    if (useSqliteApi) {
      const saved = await saveJobApiRequest({
        path: "/api/jobs/tomorrow",
        method: "DELETE",
        body: { tomorrowDate },
        errorMessage: "Unable to clear tomorrow's plan.",
      });
      return saved.ok;
    }

    setData((prev) => {
      const hasTomorrowJobs = prev.jobs.some((entry) => entry.serviceBoardTomorrowDate === tomorrowDate);
      if (!hasTomorrowJobs) return prev;

      const now = new Date().toISOString();

      return {
        ...prev,
        jobs: prev.jobs.map((entry) =>
          entry.serviceBoardTomorrowDate === tomorrowDate
            ? {
                ...entry,
                serviceBoardTomorrowDate: "",
                serviceBoardTomorrowOrder: null,
                scheduledDate: "",
                updatedAt: now,
              }
            : entry
        ),
      };
    });

    return true;
  }

  async function handleUpdateJobDetails(jobId, updates) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job) return false;

    const isStatusChanging = Boolean(updates.status && updates.status !== job.status);
    if (isStatusChanging) {
      if (useSqliteApi) {
        if (!confirmJobStatusChange(job, updates.status)) return false;
      } else {
        const statusUpdated = await handleStatusChange(jobId, updates.status);
        if (!statusUpdated) return false;
      }
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

    if (useSqliteApi) {
      const saved = await saveJobApiRequest({
        path: jobPath(jobId),
        method: "PATCH",
        body: { job: nextUpdates },
        errorMessage: "Unable to save the job details.",
      });
      if (!saved.ok) return false;

      return true;
    }

    delete nextUpdates.status;
    if (Object.keys(nextUpdates).length > 0) {
      updateJob(jobId, nextUpdates);
    }

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

    if (useSqliteApi) {
      const saved = await saveJobApiRequest({
        path: jobPath(jobId),
        method: "DELETE",
        errorMessage: "Unable to delete the job.",
      });
      if (!saved.ok) return false;

      setSelectedJob(null);
      setDocEditorOpen(false);
      return true;
    }

    setData((prev) => ({
      ...prev,
      jobs: prev.jobs.filter((entry) => entry.id !== jobId),
      deletedJobs: [
        { deletedAt: new Date().toISOString(), job },
        ...prev.deletedJobs.filter((entry) => entry.job.id !== jobId),
      ],
    }));
    setSelectedJob(null);
    setDocEditorOpen(false);
    return true;
  }

  async function handleAddJobNote(jobId, text, author = "") {
    if (!jobId) return false;
    const noteText = String(text || "").trim();
    if (!noteText) return false;

    if (useSqliteApi) {
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

    updateJob(jobId, {
      notes: [
        ...((data.jobs.find((entry) => entry.id === jobId)?.notes) || []),
        { id: crypto.randomUUID(), author, text: noteText, createdAt: new Date().toISOString() },
      ],
    });
    return true;
  }

  async function handleAddJobPhotos(jobId, photos = []) {
    if (!jobId) return false;
    const nextPhotos = Array.isArray(photos) ? photos.filter(Boolean) : [];
    if (nextPhotos.length === 0) return false;

    if (useSqliteApi) {
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

    updateJob(jobId, {
      photos: [...((data.jobs.find((entry) => entry.id === jobId)?.photos) || []), ...nextPhotos],
    });
    return true;
  }

  async function handleDeleteJobPhoto(jobId, photo) {
    if (!jobId || !photo?.id) return false;

    if (useSqliteApi) {
      const saved = await saveJobApiRequest({
        path: jobPath(jobId, `/photos/${encodeURIComponent(photo.id)}`),
        method: "DELETE",
        errorMessage: "Unable to delete the job photo.",
      });
      return saved.ok;
    }

    updateJob(jobId, {
      photos: ((data.jobs.find((entry) => entry.id === jobId)?.photos) || []).filter((entry) => entry.id !== photo.id),
    });
    return true;
  }

  function handleOpenCustomerProfile(customerId) {
    if (!canManageBusiness) return;
    setSelectedCustomerId(customerId);
    setCustomerProfileOpen(true);
  }

  function handleOpenSiteProfile(customerId, siteKey) {
    if (!canManageBusiness) return;
    const normalizedSiteKey = String(siteKey || "").trim();
    if (!customerId || !normalizedSiteKey) return;
    setSelectedSiteContext({ customerId, siteKey: normalizedSiteKey });
    setSiteProfileOpen(true);
  }

  function handleCreateSiteProfile(customerId) {
    if (!canManageBusiness || !customerId) return;
    setSelectedSiteContext({ customerId, siteKey: "__new__" });
    setSiteProfileOpen(true);
  }

  async function handleCreateCustomer(customerInput) {
    if (!canManageBusiness) return null;

    const { primarySiteType = "", primaryOcNumber = "", ...customerFields } = customerInput || {};
    const createdAt = new Date().toISOString();
    const primaryAddress = normalizeSiteAddress(customerFields.address);
    const nextSites = primaryAddress
      ? [
          normalizeSiteProfileRecord({
            id: crypto.randomUUID(),
            address: primaryAddress,
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

    if (useCustomerSqliteApi) {
      const saved = await saveCustomerApiRequest({
        path: "/api/customers",
        method: "POST",
        body: { customer: createdCustomer },
        errorMessage: "Unable to create the customer.",
      });
      if (!saved.ok) return null;

      const savedCustomer = saved.result || createdCustomer;
      setSelectedCustomerId(savedCustomer.id);
      setCustomerProfileOpen(true);
      return savedCustomer;
    }

    setData((prev) => ({
      ...prev,
      customers: [createdCustomer, ...prev.customers.filter((entry) => entry.id !== createdCustomer.id)],
    }));
    setSelectedCustomerId(createdCustomer.id);
    setCustomerProfileOpen(true);
    return createdCustomer;
  }

  async function handleSaveSiteProfile(customerId, siteInput, previousAddress = "") {
    if (!canManageBusiness) return false;

    const normalizedPreviousAddress = normalizeSiteAddress(previousAddress);
    const normalizedSite = normalizeSiteProfileRecord(siteInput);
    if (!normalizedSite) return false;

    if (useCustomerSqliteApi) {
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
      setSelectedSiteContext({ customerId, siteKey: savedSite.id || savedSite.address.toLowerCase() });
      return true;
    }

    setData((prev) => {
      const customer = prev.customers.find((entry) => entry.id === customerId);
      if (!customer) return prev;

      const currentSites = normalizeCustomerSiteProfiles(customer.sites, customer.address, customer.siteAccessNotes);
      const existingSite =
        currentSites.find((site) => site.id === normalizedSite.id || site.address.toLowerCase() === normalizedPreviousAddress.toLowerCase()) || null;
      const currentCustomerAddress = normalizeSiteAddress(customer.address);
      const isPrimarySite =
        Boolean(currentCustomerAddress)
        && currentCustomerAddress.toLowerCase() === (normalizedPreviousAddress || normalizedSite.address).toLowerCase();
      const nextSite = normalizeSiteProfileRecord({
        ...(existingSite || {}),
        ...normalizedSite,
        id: normalizedSite.id,
        createdAt:
          existingSite?.createdAt || normalizedSite.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const nextCustomerAddress = isPrimarySite ? nextSite.address : customer.address;
      const nextSites = normalizeCustomerSiteProfiles(
        [
          ...currentSites.filter(
            (site) =>
              site.id !== nextSite.id
              && site.address.toLowerCase() !== normalizedPreviousAddress.toLowerCase()
              && site.address.toLowerCase() !== nextSite.address.toLowerCase()
          ),
          nextSite,
        ],
        nextCustomerAddress,
        []
      );
      const nextCustomer = normalizeCustomerRecord({
        ...customer,
        address: nextCustomerAddress,
        sites: nextSites,
        createdAt: customer.createdAt,
      });

      const shouldSyncAddress =
        normalizedPreviousAddress
        && normalizedPreviousAddress.toLowerCase() !== nextSite.address.toLowerCase();
      const jobs = shouldSyncAddress
        ? prev.jobs.map((job) =>
            job.customerId === customerId && normalizeSiteAddress(job.jobAddress).toLowerCase() === normalizedPreviousAddress.toLowerCase()
              ? { ...job, jobAddress: nextSite.address, updatedAt: new Date().toISOString() }
              : job
          )
        : prev.jobs;
      const maintenancePlans = shouldSyncAddress
        ? (prev.maintenancePlans || []).map((plan) =>
            plan.customerId === customerId && normalizeSiteAddress(plan.siteAddress).toLowerCase() === normalizedPreviousAddress.toLowerCase()
              ? { ...plan, siteAddress: nextSite.address, updatedAt: new Date().toISOString() }
              : plan
          )
        : prev.maintenancePlans;

      return {
        ...prev,
        customers: prev.customers.map((entry) => (entry.id === customerId ? nextCustomer : entry)),
        jobs,
        maintenancePlans,
      };
    });

    setSelectedSiteContext({ customerId, siteKey: normalizedSite.address.toLowerCase() });
    return true;
  }

  async function handleDeleteSiteProfile(customerId, site) {
    if (!canManageBusiness || !site) return false;

    const confirmed = window.confirm(
      site.jobCount > 0 || site.isPrimary
        ? "Remove the saved site profile? Jobs at this address will stay, but the site-specific profile details will be cleared."
        : "Delete this saved site profile?"
    );
    if (!confirmed) return false;

    if (useCustomerSqliteApi) {
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

      setSelectedSiteContext({ customerId, siteKey: normalizeSiteAddress(site.address).toLowerCase() });
      return true;
    }

    setData((prev) => {
      const customer = prev.customers.find((entry) => entry.id === customerId);
      if (!customer) return prev;

      const targetAddress = normalizeSiteAddress(site.address).toLowerCase();
      const nextCustomer = normalizeCustomerRecord({
        ...customer,
        sites: normalizeCustomerSiteProfiles(customer.sites, customer.address, customer.siteAccessNotes).filter(
          (entry) => entry.id !== site.siteProfileId && entry.address.toLowerCase() !== targetAddress
        ),
        siteAccessNotes: normalizeSiteAccessNotes(customer.siteAccessNotes).filter(
          (entry) => entry.address.toLowerCase() !== targetAddress
        ),
        createdAt: customer.createdAt,
      });

      return {
        ...prev,
        customers: prev.customers.map((entry) => (entry.id === customerId ? nextCustomer : entry)),
      };
    });

    setSelectedSiteContext({ customerId, siteKey: normalizeSiteAddress(site.address).toLowerCase() });
    return true;
  }

  function handleOpenDoc(job, type) {
    if (!canManageBusiness) return;
    setSelectedJob(job);
    setDocType(type);
    setDocEditorOpen(true);
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
      body: JSON.stringify({
        documentType: docType,
        job: selectedFreshJob,
        document: {
          ...doc,
          sentHistory: doc.sentHistory || [],
        },
        template,
        stampText: options.stampText || "",
      }),
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
      ccEmail: docType === "invoice" ? themeSettings.invoiceCcEmail : themeSettings.quoteCcEmail,
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
        body: JSON.stringify({
          documentType: type,
          job: jobSnapshot,
          document: documentSnapshot,
          template: templateSnapshot,
          stampText: latestSentEntry.stampText || "",
        }),
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
    const recipientEmail = getDocumentRecipientEmail(selectedFreshJob);
    const recipientName = getDocumentRecipientName(selectedFreshJob);
    if (!recipientEmail) {
      window.alert(`Add a billing or customer email address before sending the ${docType}.`);
      return false;
    }
    setIsSendingDocument(true);
    const template = getDocumentTemplateSnapshot(docType);
    try {
      const requestHeaders = {
        "Content-Type": "application/json",
      };
      return await sendDocumentAndPersistHistory({
        sendEmail: async () => {
          const response = await fetch("/api/documents/send", {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify({
              job: selectedFreshJob,
              documentType: docType,
              document: {
                ...doc,
                sentHistory: doc.sentHistory || [],
              },
              template,
              stampText: options.stampText || "",
              emailPurpose: options.emailPurpose || "",
              emailSettings: {
                fromEmail: themeSettings.defaultSenderEmail,
                replyToEmail: themeSettings.replyToEmail,
                ccEmail: docType === "invoice" ? themeSettings.invoiceCcEmail : themeSettings.quoteCcEmail,
                signature: themeSettings.emailSignature,
              },
            }),
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            if (response.status === 404) {
              throw new Error("The email API needs a backend restart before invoice sending is available.");
            }
            throw new Error(payload.error || `Failed to send the ${docType} PDF.`);
          }

          return payload;
        },
        buildHistoryEntry: (payload) => ({
          id: crypto.randomUUID(),
          sentAt: payload.sentAt || new Date().toISOString(),
          fromEmail: payload.fromEmail || ADMIN_EMAIL,
          toEmail: recipientEmail,
          toName: recipientName,
          subject: payload.subject || "",
          messageId: payload.messageId || "",
          stampText: options.stampText || "",
          emailPurpose: options.emailPurpose || "",
          jobSnapshot: buildDocumentJobSnapshot(selectedFreshJob),
          documentSnapshot: normalizeDocument(docType, { ...doc, sentHistory: [] }),
          templateSnapshot: template,
        }),
        persistHistory: async ({ historyEntry }) => {
          const documentToSave = {
            ...doc,
            sentHistory: [
              ...(doc.sentHistory || []),
              historyEntry,
            ],
          };

          if (useSqliteApi) {
            const savedDocument = await handleSaveDocument(selectedFreshJob.id, docType, doc);
            if (!savedDocument) return false;

            const savedHistory = await saveDocumentApiRequest({
              path: documentPath(selectedFreshJob.id, docType, "/sent-history"),
              method: "POST",
              body: { history: historyEntry },
              errorMessage: `Email was sent, but the ${docType} send history could not be saved.`,
            });
            return savedHistory.ok;
          }

          updateJob(selectedFreshJob.id, { [docType]: normalizeDocument(docType, documentToSave) });
          return true;
        },
        onSuccess: () => {
          setDocEditorOpen(false);
          window.alert(`${docType === "invoice" ? "Invoice" : "Quote"} sent successfully with a PDF attachment.`);
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : `Failed to send the ${docType} PDF.`;
          window.alert(message);
        },
      });
    } finally {
      setIsSendingDocument(false);
    }
  }

  async function handleUpdateCustomer(customerId, updates) {
    if (!canManageBusiness) return false;

    if (useCustomerSqliteApi) {
      const saved = await saveCustomerApiRequest({
        path: customerPath(customerId),
        method: "PATCH",
        body: { customer: updates },
        errorMessage: "Unable to save the customer.",
      });
      return saved.ok ? (saved.result || true) : false;
    }

    setData((prev) => {
      const customers = prev.customers.map((customer) =>
        customer.id === customerId
          ? normalizeCustomerRecord({ ...customer, ...updates, id: customer.id, createdAt: customer.createdAt })
          : customer
      );
      const updatedCustomer = customers.find((customer) => customer.id === customerId);
      if (!updatedCustomer) return prev;
      const billingContact = getCustomerBillingContact(updatedCustomer);
      const jobs = prev.jobs.map((job) =>
        job.customerId === customerId
          ? {
              ...job,
              customerName: updatedCustomer.name,
              customerEmail: updatedCustomer.email || billingContact?.email || "",
              customerPhone: updatedCustomer.phone || billingContact?.phone || "",
            }
          : job
      );
      return { ...prev, customers, jobs };
    });

    return true;
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

    if (useCustomerSqliteApi) {
      const saved = await saveCustomerApiRequest({
        path: customerPath(customerId),
        method: "DELETE",
        errorMessage: "Unable to delete the customer.",
      });
      if (!saved.ok) return false;

      if (selectedJob?.customerId === customerId) {
        setSelectedJob(null);
        setDocEditorOpen(false);
        onCloseJobWorkspace?.({ force: true });
      }

      if (selectedSiteContext?.customerId === customerId) {
        setSelectedSiteContext(null);
        setSiteProfileOpen(false);
      }

      setSelectedCustomerId(null);
      setCustomerProfileOpen(false);
      return true;
    }

    setData((prev) => {
      const deletedAt = new Date().toISOString();
      const relatedJobsForDelete = prev.jobs.filter((job) => job.customerId === customerId);

      return {
        ...prev,
        customers: prev.customers.filter((entry) => entry.id !== customerId),
        maintenancePlans: (prev.maintenancePlans || []).filter((entry) => entry.customerId !== customerId),
        jobs: prev.jobs.filter((job) => job.customerId !== customerId),
        deletedCustomers: [
          { deletedAt, customer },
          ...prev.deletedCustomers.filter((entry) => entry.customer.id !== customerId),
        ],
        deletedJobs: [
          ...relatedJobsForDelete.map((job) => ({ deletedAt, job })),
          ...prev.deletedJobs.filter((entry) => !relatedJobsForDelete.some((job) => job.id === entry.job.id)),
        ],
      };
    });

    if (selectedJob?.customerId === customerId) {
      setSelectedJob(null);
      setDocEditorOpen(false);
      onCloseJobWorkspace?.({ force: true });
    }

    if (selectedSiteContext?.customerId === customerId) {
      setSelectedSiteContext(null);
      setSiteProfileOpen(false);
    }

    setSelectedCustomerId(null);
    setCustomerProfileOpen(false);
    return true;
  }

  async function handleRestoreDeletedJob(jobId) {
    if (!canManageBusiness) return false;

    if (useSqliteApi) {
      const saved = await saveJobApiRequest({
        path: jobPath(jobId, "/restore"),
        method: "POST",
        errorMessage: "Unable to restore the job.",
      });
      return saved.ok;
    }

    setData((prev) => {
      const deletedRecord = prev.deletedJobs.find((entry) => entry.job.id === jobId);
      if (!deletedRecord) return prev;

      let customers = prev.customers;
      let deletedCustomers = prev.deletedCustomers;
      let customer = prev.customers.find((entry) => entry.id === deletedRecord.job.customerId) || null;

      if (!customer) {
        const deletedCustomerRecord = prev.deletedCustomers.find((entry) => entry.customer.id === deletedRecord.job.customerId);
        if (deletedCustomerRecord) {
          customer = normalizeCustomerRecord(deletedCustomerRecord.customer);
          customers = [customer, ...prev.customers.filter((entry) => entry.id !== customer.id)];
          deletedCustomers = prev.deletedCustomers.filter((entry) => entry.customer.id !== customer.id);
        } else {
          customer = normalizeCustomerRecord({
            id: deletedRecord.job.customerId,
            name: deletedRecord.job.customerName,
            email: deletedRecord.job.customerEmail,
            phone: deletedRecord.job.customerPhone,
            address: deletedRecord.job.jobAddress,
            createdAt: deletedRecord.job.createdAt,
          });
          customers = [customer, ...prev.customers.filter((entry) => entry.id !== customer.id)];
        }
      }

      const restoredJobBase = syncJobWithCustomer(deletedRecord.job, customer);
      const restoredJob = {
        ...restoredJobBase,
        jobNumber: prev.jobs.some((entry) => entry.jobNumber === restoredJobBase.jobNumber && entry.id !== restoredJobBase.id)
          ? getNextJobNumber(prev.jobs)
          : restoredJobBase.jobNumber,
        updatedAt: new Date().toISOString(),
      };

      return {
        ...prev,
        customers,
        deletedCustomers,
        jobs: [restoredJob, ...prev.jobs.filter((entry) => entry.id !== restoredJob.id)],
        deletedJobs: prev.deletedJobs.filter((entry) => entry.job.id !== jobId),
      };
    });

    return true;
  }

  async function handleRestoreDeletedCustomer(customerId) {
    if (!canManageBusiness) return false;

    if (useCustomerSqliteApi) {
      const saved = await saveCustomerApiRequest({
        path: customerPath(customerId, "/restore"),
        method: "POST",
        errorMessage: "Unable to restore the customer.",
      });
      return saved.ok;
    }

    setData((prev) => {
      const deletedRecord = prev.deletedCustomers.find((entry) => entry.customer.id === customerId);
      if (!deletedRecord) return prev;

      const restoredCustomer = normalizeCustomerRecord(deletedRecord.customer);
      return {
        ...prev,
        customers: [restoredCustomer, ...prev.customers.filter((entry) => entry.id !== customerId)],
        jobs: prev.jobs.map((job) =>
          job.customerId === customerId
            ? syncJobWithCustomer(job, restoredCustomer)
            : job
        ),
        deletedCustomers: prev.deletedCustomers.filter((entry) => entry.customer.id !== customerId),
      };
    });

    return true;
  }

  async function handleEmptyDeletedJobs() {
    if (!canManageBusiness) return false;
    if (data.deletedJobs.length === 0) return false;
    const confirmed = window.confirm("Empty the deleted jobs recycle bin? This cannot be undone.");
    if (!confirmed) return false;

    if (useSqliteApi) {
      const saved = await saveJobApiRequest({
        path: "/api/deleted-jobs",
        method: "DELETE",
        errorMessage: "Unable to empty deleted jobs.",
      });
      return saved.ok;
    }

    setData((prev) => ({ ...prev, deletedJobs: [] }));
    return true;
  }

  async function handleEmptyDeletedCustomers() {
    if (!canManageBusiness) return false;
    if (data.deletedCustomers.length === 0) return false;
    const confirmed = window.confirm("Empty the deleted customers recycle bin? This cannot be undone.");
    if (!confirmed) return false;

    if (useCustomerSqliteApi) {
      const saved = await saveCustomerApiRequest({
        path: "/api/deleted-customers",
        method: "DELETE",
        errorMessage: "Unable to empty deleted customers.",
      });
      return saved.ok;
    }

    setData((prev) => ({ ...prev, deletedCustomers: [] }));
    return true;
  }

  async function handleUpdateDocumentTemplate(type, nextTemplate) {
    if (!canManageBusiness) return;
    const normalizedTemplate = normalizeDocumentTemplate(nextTemplate, type);

    if (useSqliteApi) {
      const saved = await saveSettingsApiRequest({
        path: documentTemplatePath(type),
        method: "PUT",
        body: { template: normalizedTemplate },
        errorMessage: "Unable to save the document template.",
      });
      return saved.ok;
    }

    setData((prev) => ({
      ...prev,
      [type === "invoice" ? "invoiceTemplate" : "quoteTemplate"]: normalizedTemplate,
    }));

    return true;
  }

  async function handleResetDocumentTemplate(type) {
    if (!canManageBusiness) return;
    if (useSqliteApi) {
      const saved = await saveSettingsApiRequest({
        path: documentTemplatePath(type, "/reset"),
        method: "POST",
        errorMessage: "Unable to reset the document template.",
      });
      return saved.ok;
    }

    setData((prev) => ({
      ...prev,
      [type === "invoice" ? "invoiceTemplate" : "quoteTemplate"]:
        type === "invoice"
          ? normalizeInvoiceTemplate(defaultInvoiceTemplate)
          : normalizeQuoteTemplate(defaultQuoteTemplate),
    }));

    return true;
  }

  async function handleThemeSettingChange(key, value) {
    if (!canManageBusiness) return;
    if (useSqliteApi) {
      const saved = await saveSettingsApiRequest({
        path: "/api/settings",
        method: "PATCH",
        body: { settings: { [key]: value } },
        errorMessage: "Unable to save workspace settings.",
      });
      return saved.ok;
    }

    setData((prev) => ({
      ...prev,
      settings: normalizeThemeSettings({
        ...prev.settings,
        [key]: value,
      }),
    }));

    return true;
  }

  async function handleApplyThemePreset(values) {
    if (!canManageBusiness) return;
    if (useSqliteApi) {
      const saved = await saveSettingsApiRequest({
        path: "/api/settings",
        method: "PATCH",
        body: { settings: values },
        errorMessage: "Unable to apply the theme preset.",
      });
      return saved.ok;
    }

    setData((prev) => ({
      ...prev,
      settings: normalizeThemeSettings({
        ...prev.settings,
        ...values,
      }),
    }));

    return true;
  }

  async function handleResetUiSettings() {
    if (!canManageBusiness) return;
    if (useSqliteApi) {
      const saved = await saveSettingsApiRequest({
        path: "/api/settings/reset",
        method: "POST",
        body: { group: "ui" },
        errorMessage: "Unable to reset UI settings.",
      });
      return saved.ok;
    }

    setData((prev) => ({
      ...prev,
      settings: normalizeThemeSettings({
        ...prev.settings,
        ...pickSettings(defaultThemeSettings, uiSettingKeys),
      }),
    }));

    return true;
  }

  async function handleResetPreferences() {
    if (!canManageBusiness) return;
    if (useSqliteApi) {
      const saved = await saveSettingsApiRequest({
        path: "/api/settings/reset",
        method: "POST",
        body: { group: "preferences" },
        errorMessage: "Unable to reset preference settings.",
      });
      return saved.ok;
    }

    setData((prev) => ({
      ...prev,
      settings: normalizeThemeSettings({
        ...prev.settings,
        ...pickSettings(defaultThemeSettings, preferenceSettingKeys),
      }),
    }));

    return true;
  }

  return {
    createJob,
    handleAddInvoicePayment,
    handleAddJobNote,
    handleAddJobPhotos,
    handleApplyThemePreset,
    handleCreateCustomer,
    handleCreateInventoryItem,
    handleCreateMaintenancePlan,
    handleCreateStaff,
    handleCreateSiteProfile,
    handleDeleteCustomer,
    handleDeleteDocument,
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
    handleOpenCustomerProfile,
    handleOpenDoc,
    handlePreviewDocument,
    handleOpenSentDocumentCopy,
    handleOpenJob,
    handlePlanJobForTomorrow,
    handleOpenSiteProfile,
    handleRemoveAllJobsFromTomorrow,
    handleRemoveJobFromTomorrow,
    handleResetDocumentTemplate,
    handleResetPreferences,
    handleResetUiSettings,
    handleRestoreDeletedCustomer,
    handleRestoreDeletedJob,
    handleSaveDocument,
    handleSaveSiteProfile,
    handleScheduleJob,
    handleSendDocument,
    handleStatusChange,
    handleThemeSettingChange,
    handleUpdateCustomer,
    handleUpdateDocumentTemplate,
    handleUpdateInventoryItem,
    handleUpdateInvoicePayment,
    handleUpdateJobDetails,
    handleUpdateMaintenancePlan,
    handleUpdateStaff,
    updateJob,
  };
}
