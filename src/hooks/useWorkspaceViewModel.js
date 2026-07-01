import { useMemo } from "react";
import {
  addDaysToDateInput,
  buildCustomerSites,
  findSupplierManualMatches,
  getInventoryStockStatus,
  getInvoicePaymentSummary,
  getInvoiceStatus,
  getMaintenancePlanStatus,
  sectionMeta,
  settingsTabMeta,
  sideNavItems,
  toDateInputValue,
  toTimestamp,
} from "@/lib/app-support";
import { calculateInvoiceTotal, calculateQuoteTotal } from "@/lib/quote-template";

export function useWorkspaceViewModel({
  activeSection,
  activeSettingsTab,
  authUser,
  data,
  isTechnician,
  officeSearch,
  selectedCustomerId,
  selectedJob,
  selectedSiteContext,
  serviceBoardFullScreen,
  showHighUrgencyOnly,
  supplierManuals,
}) {
  const tomorrowPlanningDate = addDaysToDateInput(toDateInputValue(new Date()), 1);

  const filteredJobs = useMemo(() => {
    const q = officeSearch.toLowerCase();
    return data.jobs.filter((job) => {
      const matchesText = [job.customerName, job.title, job.description, job.jobAddress, job.scheduledDate]
        .join(" ")
        .toLowerCase()
        .includes(q);
      const matchesUrgency = showHighUrgencyOnly ? job.urgency === "High" : true;
      return matchesText && matchesUrgency;
    });
  }, [data.jobs, officeSearch, showHighUrgencyOnly]);

  const tomorrowJobs = useMemo(() => {
    return [...data.jobs]
      .filter((job) => job.serviceBoardTomorrowDate === tomorrowPlanningDate)
      .sort((a, b) => {
        const aOrder = Number.isFinite(Number(a.serviceBoardTomorrowOrder)) ? Number(a.serviceBoardTomorrowOrder) : Number.MAX_SAFE_INTEGER;
        const bOrder = Number.isFinite(Number(b.serviceBoardTomorrowOrder)) ? Number(b.serviceBoardTomorrowOrder) : Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder
          || toTimestamp(a.scheduledDate) - toTimestamp(b.scheduledDate)
          || toTimestamp(a.updatedAt) - toTimestamp(b.updatedAt)
          || (a.jobNumber || 0) - (b.jobNumber || 0);
      });
  }, [data.jobs, tomorrowPlanningDate]);

  const dashboard = useMemo(() => {
    const quotesValue = data.jobs.reduce((sum, job) => sum + (job.quote ? calculateQuoteTotal(job.quote.items) : 0), 0);
    const invoicesValue = data.jobs.reduce((sum, job) => sum + (job.invoice ? calculateInvoiceTotal(job.invoice.items) : 0), 0);
    const completedJobs = data.jobs.filter((job) => job.status === "Completed").length;
    const quotesCount = data.jobs.filter((job) => job.quote).length;
    const invoicesCount = data.jobs.filter((job) => job.invoice).length;
    const invoiceRows = data.jobs.filter((job) => job.invoice || job.status === "Completed");
    const paidInvoices = invoiceRows.filter((job) => getInvoiceStatus(job).id === "paid").length;
    const overdueInvoices = invoiceRows.filter((job) => getInvoiceStatus(job).id === "overdue").length;
    const notInvoicedCompleted = invoiceRows.filter((job) => getInvoiceStatus(job).id === "not-invoiced").length;
    const outstandingInvoiceValue = invoiceRows.reduce((sum, job) => {
      if (!job.invoice) return sum;
      return sum + getInvoicePaymentSummary(job.invoice).balanceAmount;
    }, 0);
    const todayKey = toDateInputValue(new Date());
    const scheduledJobs = data.jobs.filter((job) => toDateInputValue(job.scheduledDate)).length;
    const scheduledToday = data.jobs.filter((job) => toDateInputValue(job.scheduledDate) === todayKey).length;
    const unscheduledOpenJobs = data.jobs.filter((job) => !toDateInputValue(job.scheduledDate) && job.status !== "Completed").length;
    const inventoryItems = data.inventoryItems || [];
    const maintenancePlans = data.maintenancePlans || [];
    const lowStockParts = inventoryItems.filter((item) => {
      const status = getInventoryStockStatus(item);
      return status.id === "low" || status.id === "out";
    }).length;
    const inventoryValue = inventoryItems.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
    const maintenanceStatuses = maintenancePlans.map((plan) => getMaintenancePlanStatus(plan, data.jobs).id);
    const overdueMaintenancePlans = maintenanceStatuses.filter((status) => status === "overdue").length;
    const dueSoonMaintenancePlans = maintenanceStatuses.filter((status) => status === "due-soon").length;
    const activeMaintenancePlans = maintenanceStatuses.filter((status) => status === "active-job").length;

    return {
      totalJobs: data.jobs.length,
      totalCustomers: data.customers.length,
      totalParts: inventoryItems.length,
      totalMaintenancePlans: maintenancePlans.length,
      overdueMaintenancePlans,
      dueSoonMaintenancePlans,
      activeMaintenancePlans,
      lowStockParts,
      inventoryValue,
      scheduledJobs,
      scheduledToday,
      unscheduledOpenJobs,
      openJobs: data.jobs.length - completedJobs,
      completedJobs,
      highUrgency: data.jobs.filter((job) => job.urgency === "High").length,
      quotesCount,
      invoicesCount,
      paidInvoices,
      overdueInvoices,
      notInvoicedCompleted,
      outstandingInvoiceValue,
      quotesValue,
      invoicesValue,
    };
  }, [data.customers, data.inventoryItems, data.jobs, data.maintenancePlans]);

  const visibleSideNavItems = useMemo(
    () => (isTechnician ? sideNavItems.filter((item) => item.id === "service-board") : sideNavItems),
    [isTechnician]
  );

  const selection = useMemo(() => {
    const selectedFreshJob = selectedJob ? data.jobs.find((job) => job.id === selectedJob.id) || null : null;
    const selectedFreshCustomer = selectedFreshJob
      ? data.customers.find((customer) => customer.id === selectedFreshJob.customerId) || null
      : null;
    const selectedFreshCustomerJobs = selectedFreshCustomer
      ? data.jobs.filter((job) => job.customerId === selectedFreshCustomer.id)
      : [];
    const selectedCustomer = selectedCustomerId
      ? data.customers.find((customer) => customer.id === selectedCustomerId) || null
      : null;
    const selectedCustomerJobs = selectedCustomerId
      ? data.jobs.filter((job) => job.customerId === selectedCustomerId)
      : [];
    const selectedSiteCustomer = selectedSiteContext
      ? data.customers.find((customer) => customer.id === selectedSiteContext.customerId) || null
      : null;
    const selectedSiteJobs = selectedSiteCustomer
      ? data.jobs.filter((job) => job.customerId === selectedSiteCustomer.id)
      : [];
    const selectedSite = selectedSiteCustomer && selectedSiteContext
      ? buildCustomerSites(selectedSiteCustomer, selectedSiteJobs).find(
          (site) => site.id === selectedSiteContext.siteKey || site.siteProfileId === selectedSiteContext.siteKey
        ) || null
      : null;

    return {
      selectedFreshJob,
      selectedFreshCustomer,
      selectedFreshCustomerJobs,
      selectedCustomer,
      selectedCustomerJobs,
      selectedSiteCustomer,
      selectedSiteJobs,
      selectedSite,
    };
  }, [data.customers, data.jobs, selectedCustomerId, selectedJob, selectedSiteContext]);

  const selectedSupplierManualMatches = useMemo(
    () => findSupplierManualMatches(selection.selectedFreshJob, supplierManuals, 8),
    [selection.selectedFreshJob, supplierManuals]
  );

  const isServiceBoardFullScreen = activeSection === "service-board" && serviceBoardFullScreen;

  const currentSection = useMemo(() => {
    const serviceBoardMeta = isTechnician
      ? {
          eyebrow: "Technician Workspace",
          title: "Field Jobs",
          description: "Review field jobs, drag them between columns to update status, add field notes and photos, and keep work moving from the field.",
        }
      : sectionMeta["service-board"];

    if (activeSection === "settings") {
      return settingsTabMeta[activeSettingsTab] || sectionMeta.settings;
    }

    if (activeSection === "service-board") {
      return serviceBoardMeta;
    }

    return sectionMeta[activeSection] || serviceBoardMeta;
  }, [activeSection, activeSettingsTab, isTechnician]);

  const noteAuthor = authUser?.name || (isTechnician ? "Technician" : "Office");

  return {
    dashboard,
    currentSection,
    filteredJobs,
    isServiceBoardFullScreen,
    noteAuthor,
    selectedSupplierManualMatches,
    tomorrowJobs,
    tomorrowPlanningDate,
    visibleSideNavItems,
    ...selection,
  };
}
