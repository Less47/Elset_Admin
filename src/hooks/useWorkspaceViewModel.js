import { matchesJobBillingFilter } from "@/lib/job-billing";
import { useMemo } from "react";
import {
  addDaysToDateInput,
  sectionMeta,
  settingsTabMeta,
  sideNavItems,
  toDateInputValue,
  toTimestamp,
} from "@/lib/app-support";

export function useWorkspaceViewModel({
  activeSection,
  activeSettingsTab,
  authUser,
  data,
  isTechnician,
  officeSearch,
  selectedJob,
  serviceBoardFullScreen,
  showHighUrgencyOnly,
  billingTypeFilter = "all",
}) {
  const tomorrowPlanningDate = addDaysToDateInput(toDateInputValue(new Date()), 1);

  const filteredJobs = useMemo(() => {
    const q = officeSearch.toLowerCase();
    return data.jobs.filter((job) => {
      const matchesText = [job.jobNumber, job.customerName, job.title, job.description, job.jobAddress, job.scheduledDate, job.billingType || "billable", job.warrantyReason]
        .join(" ")
        .toLowerCase()
        .includes(q);
      const matchesUrgency = showHighUrgencyOnly ? job.urgency === "High" : true;
      return matchesText && matchesUrgency && matchesJobBillingFilter(job, billingTypeFilter);
    });
  }, [data.jobs, officeSearch, showHighUrgencyOnly, billingTypeFilter]);

  const tomorrowJobs = useMemo(() => {
    return [...filteredJobs]
      .filter((job) => job.serviceBoardTomorrowDate === tomorrowPlanningDate)
      .sort((a, b) => {
        const aOrder = Number.isFinite(Number(a.serviceBoardTomorrowOrder)) ? Number(a.serviceBoardTomorrowOrder) : Number.MAX_SAFE_INTEGER;
        const bOrder = Number.isFinite(Number(b.serviceBoardTomorrowOrder)) ? Number(b.serviceBoardTomorrowOrder) : Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder
          || toTimestamp(a.scheduledDate) - toTimestamp(b.scheduledDate)
          || toTimestamp(a.updatedAt) - toTimestamp(b.updatedAt)
          || (a.jobNumber || 0) - (b.jobNumber || 0);
      });
  }, [filteredJobs, tomorrowPlanningDate]);

  const visibleSideNavItems = useMemo(
    () => (isTechnician ? sideNavItems.filter((item) => ["service-board", "settings"].includes(item.id)) : sideNavItems),
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
    return {
      selectedFreshJob,
      selectedFreshCustomer,
      selectedFreshCustomerJobs,
    };
  }, [data.customers, data.jobs, selectedJob]);

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
    currentSection,
    filteredJobs,
    isServiceBoardFullScreen,
    noteAuthor,
    tomorrowJobs,
    tomorrowPlanningDate,
    visibleSideNavItems,
    ...selection,
  };
}
