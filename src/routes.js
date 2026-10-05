// Section content stays in WorkspaceShell; record pages render through its Outlet.
function SectionRoute() { return null; }

// The route tree is shared by the browser router and route-matching tests.
export const workspaceRoutes = [
  { index: true, id: "home", Component: SectionRoute },
  { path: "customers", children: [
    { index: true, id: "customers", Component: SectionRoute, handle: { section: "customers" } },
    { path: "new", id: "create-customer", lazy: async () => ({ Component: (await import("./components/customers/CustomerPages.jsx")).default }), handle: { section: "customers", record: true, label: "Customers" } },
    { path: ":customerId", children: [
      { index: true, id: "customer-details", lazy: async () => ({ Component: (await import("./components/customers/CustomerPages.jsx")).default }), handle: { section: "customers", record: true, label: "Customer Profile" } },
      { path: "edit", id: "edit-customer", lazy: async () => ({ Component: (await import("./components/customers/CustomerPages.jsx")).default }), handle: { section: "customers", record: true, label: "Edit Customer" } },
      { path: "sites", children: [
        { path: "new", id: "create-site", lazy: async () => ({ Component: (await import("./components/customers/CustomerPages.jsx")).default }), handle: { section: "customers", record: true, label: "Customer Profile" } },
        { path: ":siteId", children: [
          { index: true, id: "site-details", lazy: async () => ({ Component: (await import("./components/customers/CustomerPages.jsx")).default }), handle: { section: "customers", record: true, label: "Site Profile" } },
          { path: "edit", id: "edit-site", lazy: async () => ({ Component: (await import("./components/customers/CustomerPages.jsx")).default }), handle: { section: "customers", record: true, label: "Edit Site" } },
        ] },
      ] },
    ] },
  ] },
  { path: "jobs", children: [
    { path: "new", id: "create-job", lazy: async () => ({ Component: (await import("./components/jobs/JobRoutePages.jsx")).CreateJobRoute }), handle: { record: true, label: "Service Board" } },
    { path: ":jobId", children: [
      { index: true, id: "job-details", lazy: async () => ({ Component: (await import("./components/jobs/JobRoutePages.jsx")).JobDetailsRoute }), handle: { record: true, label: ({ jobId }, jobs) => `Job #${jobs.find((job) => job.id === jobId)?.jobNumber || "Details"}` } },
      { path: "quote", id: "quote", lazy: async () => ({ Component: (await import("./components/jobs/JobRoutePages.jsx")).DocumentRoute }), handle: { record: true, documentType: "quote" } },
      { path: "invoice", id: "invoice", lazy: async () => ({ Component: (await import("./components/jobs/JobRoutePages.jsx")).DocumentRoute }), handle: { record: true, documentType: "invoice" } },
    ] },
  ] },
  { path: "maintenance", children: [
    { index: true, id: "maintenance", Component: SectionRoute, handle: { section: "maintenance" } },
    { path: "new", id: "create-maintenance", lazy: async () => ({ Component: (await import("./components/maintenance/MaintenancePlanPage.jsx")).default }), handle: { section: "maintenance", record: true } },
    { path: ":planId", children: [
      { index: true, id: "maintenance-details", lazy: async () => ({ Component: (await import("./components/maintenance/MaintenancePlanPage.jsx")).default }), handle: { section: "maintenance", record: true, label: "Maintenance" } },
      { path: "edit", id: "edit-maintenance", lazy: async () => ({ Component: (await import("./components/maintenance/MaintenancePlanPage.jsx")).default }), handle: { section: "maintenance", record: true, label: "Maintenance" } },
    ] },
  ] },
  { path: "invoices", id: "invoices", Component: SectionRoute, handle: { section: "invoices" } },
  { path: "maintenance-reports/:reportId", id: "maintenance-service-report", lazy: async () => ({ Component: (await import("./components/maintenance/MaintenanceServiceReportPage.jsx")).default }), handle: { section: "maintenance", record: true, label: "Maintenance" } },
  { path: "maintenance-reports", id: "maintenance-service-history", lazy: async () => ({ Component: (await import("./components/maintenance/MaintenanceServiceReportPage.jsx")).default }), handle: { section: "maintenance", record: true, label: "Maintenance" } },
  { path: "statistics", id: "statistics", Component: SectionRoute, handle: { section: "statistics" } },
  { path: "map", id: "map", Component: SectionRoute, handle: { section: "map" } },
  { path: "settings", id: "settings", Component: SectionRoute, handle: { section: "settings" } },
  { path: "*", id: "fallback", Component: SectionRoute, handle: { section: "service-board" } },
];
