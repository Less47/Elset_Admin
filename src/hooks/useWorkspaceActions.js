import {
  buildMaintenanceJobDescription,
  defaultThemeSettings,
  getNextJobNumber,
  getNextMaintenanceDueDate,
  normalizeCustomerRecord,
  normalizeCustomerSiteProfiles,
  normalizeDocument,
  normalizeInventoryRecord,
  normalizeJobRecord,
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
  normalizeDocumentTemplate,
  normalizeInvoiceTemplate,
  normalizeQuoteTemplate,
} from "@/lib/quote-template";

export function useWorkspaceActions({
  canManageBusiness,
  data,
  docType,
  selectedFreshJob,
  selectedJob,
  selectedSiteContext,
  setCustomerProfileOpen,
  setData,
  setDocEditorOpen,
  setDocType,
  setIsSendingDocument,
  setJobDetailsOpen,
  setJobEditOpen,
  setSelectedCustomerId,
  setSelectedJob,
  setSelectedSiteContext,
  setSiteProfileOpen,
  themeSettings,
}) {
  function createJob({ job, customerMode, customer, technician, siteInput = null }) {
    if (!canManageBusiness) return;

    setData((prev) => {
      let customerRecord = customer;
      let customers = prev.customers;
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
        customers = [...prev.customers, customerRecord];
      } else if (customer?.id) {
        const existingCustomer = prev.customers.find((entry) => entry.id === customer.id) || customer;

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
          customers = prev.customers.map((entry) => (entry.id === customerRecord.id ? customerRecord : entry));
        } else {
          customerRecord = existingCustomer;
        }
      }

      const newJob = normalizeJobRecord({
        id: crypto.randomUUID(),
        jobNumber: getNextJobNumber(prev.jobs),
        title: job.title,
        description: job.description,
        urgency: job.urgency,
        status: "To Do",
        scheduledDate: toDateInputValue(job.scheduledDate),
        assignedTechnicianId: technician.id,
        assignedTechnicianName: technician.name,
        customerId: customerRecord.id,
        customerName: customerRecord.name,
        customerEmail: customerRecord.email,
        customerPhone: customerRecord.phone,
        jobAddress: normalizeSiteAddress(job.jobAddress || normalizedSiteInput?.address || customerRecord.address),
        createdAt: now,
        updatedAt: now,
        notes: [],
        photos: [],
        quote: null,
        invoice: null,
      });

      return {
        ...prev,
        customers,
        jobs: [newJob, ...prev.jobs],
      };
    });
  }

  function handleCreateStaff(staffInput) {
    if (!canManageBusiness) return null;

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

  function handleUpdateStaff(staffId, updates) {
    if (!canManageBusiness) return null;

    const nextUpdatedAt = new Date().toISOString();
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
      const jobs = prev.jobs.map((job) => (
        job.assignedTechnicianId === staffId
          ? {
              ...job,
              assignedTechnicianName: updatedStaff?.name || job.assignedTechnicianName,
              updatedAt: nextUpdatedAt,
            }
          : job
      ));

      return {
        ...prev,
        staff,
        jobs,
      };
    });

    return updatedStaff;
  }

  function handleCreateInventoryItem(partInput) {
    if (!canManageBusiness) return false;

    const createdPart = normalizeInventoryRecord({
      id: crypto.randomUUID(),
      ...partInput,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    setData((prev) => ({
      ...prev,
      inventoryItems: [createdPart, ...(prev.inventoryItems || []).filter((entry) => entry.id !== createdPart.id)],
    }));

    return true;
  }

  function handleUpdateInventoryItem(partId, updates) {
    if (!canManageBusiness) return false;

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

  function handleDeleteInventoryItem(partId) {
    if (!canManageBusiness) return false;

    const part = (data.inventoryItems || []).find((entry) => entry.id === partId);
    if (!part) return false;

    const confirmed = window.confirm(`Delete ${part.name} from parts inventory?`);
    if (!confirmed) return false;

    setData((prev) => ({
      ...prev,
      inventoryItems: (prev.inventoryItems || []).filter((entry) => entry.id !== partId),
    }));

    return true;
  }

  function handleCreateMaintenancePlan(planInput) {
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

    setData((prev) => ({
      ...prev,
      maintenancePlans: [createdPlan, ...(prev.maintenancePlans || []).filter((entry) => entry.id !== createdPlan.id)],
    }));

    return true;
  }

  function handleUpdateMaintenancePlan(planId, updates) {
    if (!canManageBusiness) return false;

    const existingPlan = (data.maintenancePlans || []).find((entry) => entry.id === planId);
    if (!existingPlan) return false;

    const customer = data.customers.find((entry) => entry.id === updates.customerId);
    if (!customer) {
      window.alert("Select a valid customer before saving the maintenance plan.");
      return false;
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

  function handleDeleteMaintenancePlan(planId) {
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

    setData((prev) => ({
      ...prev,
      maintenancePlans: (prev.maintenancePlans || []).filter((entry) => entry.id !== planId),
    }));

    return true;
  }

  function handleOpenJob(job) {
    setSelectedJob(job);
    setJobDetailsOpen(true);
  }

  function handleGenerateMaintenanceJob(planId) {
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

    const technician = data.staff.find((entry) => entry.id === plan.defaultTechnicianId) || data.staff[0] || null;
    const now = new Date().toISOString();
    const newJob = normalizeJobRecord({
      id: crypto.randomUUID(),
      jobNumber: getNextJobNumber(data.jobs),
      title: plan.planName,
      description: buildMaintenanceJobDescription(plan),
      urgency: "Medium",
      status: "To Do",
      scheduledDate: dueDate,
      assignedTechnicianId: technician?.id || "",
      assignedTechnicianName: technician?.name || "",
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      jobAddress: plan.siteAddress || customer.address,
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

    setSelectedJob(newJob);
    setJobDetailsOpen(true);
    return true;
  }

  function handleScheduleJob(jobId, scheduledDate) {
    if (!canManageBusiness) return false;
    updateJob(jobId, { scheduledDate: toDateInputValue(scheduledDate) });
    return true;
  }

  function handleUpdateInvoicePayment(jobId, updates) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job?.invoice) return false;

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

  function handleStatusChange(jobId, nextStatus) {
    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job || !nextStatus || job.status === nextStatus) return false;

    if (job.status === "Completed" && nextStatus !== "Completed") {
      const confirmed = window.confirm("Are you sure? This job has already been marked as completed.");
      if (!confirmed) return false;
    }

    const now = new Date().toISOString();
    setData((prev) => ({
      ...prev,
      jobs: prev.jobs.map((entry) =>
        entry.id === jobId ? { ...entry, status: nextStatus, updatedAt: now } : entry
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

  function handleUpdateJobDetails(jobId, updates) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job) return false;

    if (updates.status && updates.status !== job.status) {
      const statusUpdated = handleStatusChange(jobId, updates.status);
      if (!statusUpdated) return false;
    }

    const nextUpdates = { ...updates };
    delete nextUpdates.status;
    if (Object.prototype.hasOwnProperty.call(nextUpdates, "scheduledDate")) {
      nextUpdates.scheduledDate = toDateInputValue(nextUpdates.scheduledDate);
    }
    if (Object.keys(nextUpdates).length > 0) {
      updateJob(jobId, nextUpdates);
    }

    setJobEditOpen(false);
    setJobDetailsOpen(true);
    return true;
  }

  function handleDeleteJob(jobId) {
    if (!canManageBusiness) return false;

    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job) return false;

    const confirmed = window.confirm(
      `Delete Job #${job.jobNumber}? This will remove the job, saved quote/invoice data, notes, and photos.`
    );
    if (!confirmed) return false;

    setData((prev) => ({
      ...prev,
      jobs: prev.jobs.filter((entry) => entry.id !== jobId),
      deletedJobs: [
        { deletedAt: new Date().toISOString(), job },
        ...prev.deletedJobs.filter((entry) => entry.job.id !== jobId),
      ],
    }));
    setSelectedJob(null);
    setJobDetailsOpen(false);
    setJobEditOpen(false);
    setDocEditorOpen(false);
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

  function handleCreateCustomer(customerInput) {
    if (!canManageBusiness) return null;

    const { primarySiteType = "", ...customerFields } = customerInput || {};
    const createdAt = new Date().toISOString();
    const primaryAddress = normalizeSiteAddress(customerFields.address);
    const nextSites = primaryAddress
      ? [
          normalizeSiteProfileRecord({
            id: crypto.randomUUID(),
            address: primaryAddress,
            siteType: primarySiteType,
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

    setData((prev) => ({
      ...prev,
      customers: [createdCustomer, ...prev.customers.filter((entry) => entry.id !== createdCustomer.id)],
    }));
    setSelectedCustomerId(createdCustomer.id);
    setCustomerProfileOpen(true);
    return createdCustomer;
  }

  function handleSaveSiteProfile(customerId, siteInput, previousAddress = "") {
    if (!canManageBusiness) return false;

    const normalizedPreviousAddress = normalizeSiteAddress(previousAddress);
    const normalizedSite = normalizeSiteProfileRecord(siteInput);
    if (!normalizedSite) return false;

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

  function handleDeleteSiteProfile(customerId, site) {
    if (!canManageBusiness || !site) return false;

    const confirmed = window.confirm(
      site.jobCount > 0 || site.isPrimary
        ? "Remove the saved site profile? Jobs at this address will stay, but the site-specific profile details will be cleared."
        : "Delete this saved site profile?"
    );
    if (!confirmed) return false;

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
      assignedTechnicianId: job.assignedTechnicianId,
      assignedTechnicianName: job.assignedTechnicianName,
      customerId: job.customerId,
      customerName: job.customerName,
      customerEmail: job.customerEmail,
      customerPhone: job.customerPhone,
      jobAddress: job.jobAddress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
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

  async function handleSendDocument(doc) {
    if (!canManageBusiness || !selectedFreshJob) return;
    if (!selectedFreshJob.customerEmail) {
      window.alert(`Add a customer email address before sending the ${docType}.`);
      return;
    }

    const priorAttempts = data.jobs.reduce((count, job) => {
      if (job.customerId !== selectedFreshJob.customerId) return count;
      return count + (job[docType]?.sentHistory?.length || 0);
    }, 0);

    const documentLabel = docType === "invoice" ? "invoice" : "quote";
    const previousSendWarning = priorAttempts > 0
      ? `\n\nThis customer already has ${priorAttempts} previous ${documentLabel} send ${priorAttempts === 1 ? "attempt" : "attempts"}.`
      : "";
    const confirmed = window.confirm(
      `Are you sure you want to send this ${documentLabel} to ${selectedFreshJob.customerEmail}?${previousSendWarning}\n\nThis will email the customer a PDF attachment.`
    );
    if (!confirmed) return;

    try {
      setIsSendingDocument(true);
      const template = getDocumentTemplateSnapshot(docType);
      const requestHeaders = {
        "Content-Type": "application/json",
      };
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

      const documentToSave = {
        ...doc,
        sentHistory: [
          ...(doc.sentHistory || []),
          {
            id: crypto.randomUUID(),
            sentAt: payload.sentAt || new Date().toISOString(),
            fromEmail: payload.fromEmail || ADMIN_EMAIL,
            toEmail: selectedFreshJob.customerEmail,
            messageId: payload.messageId || "",
            jobSnapshot: buildDocumentJobSnapshot(selectedFreshJob),
            documentSnapshot: normalizeDocument(docType, { ...doc, sentHistory: [] }),
            templateSnapshot: template,
          },
        ],
      };

      updateJob(selectedFreshJob.id, { [docType]: normalizeDocument(docType, documentToSave) });
      setDocEditorOpen(false);
      window.alert(`${docType === "invoice" ? "Invoice" : "Quote"} sent successfully with a PDF attachment.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to send the ${docType} PDF.`;
      window.alert(message);
    } finally {
      setIsSendingDocument(false);
    }
  }

  function handleUpdateCustomer(customerId, updates) {
    if (!canManageBusiness) return;

    setData((prev) => {
      const customers = prev.customers.map((customer) =>
        customer.id === customerId
          ? normalizeCustomerRecord({ ...customer, ...updates, id: customer.id, createdAt: customer.createdAt })
          : customer
      );
      const updatedCustomer = customers.find((customer) => customer.id === customerId);
      if (!updatedCustomer) return prev;
      const jobs = prev.jobs.map((job) =>
        job.customerId === customerId
          ? {
              ...job,
              customerName: updatedCustomer.name,
              customerEmail: updatedCustomer.email,
              customerPhone: updatedCustomer.phone,
            }
          : job
      );
      return { ...prev, customers, jobs };
    });
  }

  function handleDeleteCustomer(customerId) {
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
      setJobDetailsOpen(false);
      setJobEditOpen(false);
      setDocEditorOpen(false);
    }

    if (selectedSiteContext?.customerId === customerId) {
      setSelectedSiteContext(null);
      setSiteProfileOpen(false);
    }

    setSelectedCustomerId(null);
    setCustomerProfileOpen(false);
    return true;
  }

  function handleRestoreDeletedJob(jobId) {
    if (!canManageBusiness) return false;

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

  function handleRestoreDeletedCustomer(customerId) {
    if (!canManageBusiness) return false;

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

  function handleEmptyDeletedJobs() {
    if (!canManageBusiness) return false;
    if (data.deletedJobs.length === 0) return false;
    const confirmed = window.confirm("Empty the deleted jobs recycle bin? This cannot be undone.");
    if (!confirmed) return false;

    setData((prev) => ({ ...prev, deletedJobs: [] }));
    return true;
  }

  function handleEmptyDeletedCustomers() {
    if (!canManageBusiness) return false;
    if (data.deletedCustomers.length === 0) return false;
    const confirmed = window.confirm("Empty the deleted customers recycle bin? This cannot be undone.");
    if (!confirmed) return false;

    setData((prev) => ({ ...prev, deletedCustomers: [] }));
    return true;
  }

  function handleUpdateDocumentTemplate(type, nextTemplate) {
    if (!canManageBusiness) return;
    setData((prev) => ({
      ...prev,
      [type === "invoice" ? "invoiceTemplate" : "quoteTemplate"]: normalizeDocumentTemplate(nextTemplate, type),
    }));
  }

  function handleResetDocumentTemplate(type) {
    if (!canManageBusiness) return;
    setData((prev) => ({
      ...prev,
      [type === "invoice" ? "invoiceTemplate" : "quoteTemplate"]:
        type === "invoice"
          ? normalizeInvoiceTemplate(defaultInvoiceTemplate)
          : normalizeQuoteTemplate(defaultQuoteTemplate),
    }));
  }

  function handleThemeSettingChange(key, value) {
    if (!canManageBusiness) return;
    setData((prev) => ({
      ...prev,
      settings: normalizeThemeSettings({
        ...prev.settings,
        [key]: value,
      }),
    }));
  }

  function handleApplyThemePreset(values) {
    if (!canManageBusiness) return;
    setData((prev) => ({
      ...prev,
      settings: normalizeThemeSettings({
        ...prev.settings,
        ...values,
      }),
    }));
  }

  function handleResetUiSettings() {
    if (!canManageBusiness) return;
    setData((prev) => ({
      ...prev,
      settings: normalizeThemeSettings({
        ...prev.settings,
        ...pickSettings(defaultThemeSettings, uiSettingKeys),
      }),
    }));
  }

  function handleResetPreferences() {
    if (!canManageBusiness) return;
    setData((prev) => ({
      ...prev,
      settings: normalizeThemeSettings({
        ...prev.settings,
        ...pickSettings(defaultThemeSettings, preferenceSettingKeys),
      }),
    }));
  }

  return {
    createJob,
    handleApplyThemePreset,
    handleCreateCustomer,
    handleCreateInventoryItem,
    handleCreateMaintenancePlan,
    handleCreateStaff,
    handleCreateSiteProfile,
    handleDeleteCustomer,
    handleDeleteInventoryItem,
    handleDeleteJob,
    handleDeleteMaintenancePlan,
    handleDeleteSiteProfile,
    handleEmptyDeletedCustomers,
    handleEmptyDeletedJobs,
    handleGenerateMaintenanceJob,
    handleOpenCustomerProfile,
    handleOpenDoc,
    handleOpenSentDocumentCopy,
    handleOpenJob,
    handleOpenSiteProfile,
    handleResetDocumentTemplate,
    handleResetPreferences,
    handleResetUiSettings,
    handleRestoreDeletedCustomer,
    handleRestoreDeletedJob,
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
