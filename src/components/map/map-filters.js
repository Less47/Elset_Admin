// Original ELSET Map definitions, shared by both rendering providers.
export const ALL_FILTER_VALUE = "all";
export const NOT_SET_FILTER_VALUE = "not-set";
export const JOB_FILTERS = [
  { value: "all", label: "All Jobs" },
  { value: "incomplete", label: "Incomplete" },
  { value: "urgent", label: "Urgent" },
  { value: "completed", label: "Completed" },
];

export function matchesMapFilters(job, { search = "", jobFilter = ALL_FILTER_VALUE, siteTypeFilter = ALL_FILTER_VALUE, customerTypeFilter = ALL_FILTER_VALUE } = {}, labels = {}) {
  const query = search.toLowerCase().trim();
  const matchesQuery = !query || [job.jobNumber, job.customerName, job.title, job.description, job.jobAddress,
    labels.formatCustomerType ? labels.formatCustomerType(job.customerType) : job.customerTypeLabel,
    labels.formatSiteType ? labels.formatSiteType(job.siteType) : job.siteTypeLabel,
  ].join(" ").toLowerCase().includes(query);
  // Urgent intentionally includes completed high-urgency jobs, as on /map.
  const matchesJob = jobFilter === "incomplete" ? job.status !== "Completed"
    : jobFilter === "urgent" ? job.urgency === "High"
      : jobFilter === "completed" ? job.status === "Completed" : true;
  const matchesType = (value, filter) => filter === ALL_FILTER_VALUE || (filter === NOT_SET_FILTER_VALUE ? !value : value === filter);
  return matchesQuery && matchesJob && matchesType(job.siteType, siteTypeFilter) && matchesType(job.customerType, customerTypeFilter);
}
