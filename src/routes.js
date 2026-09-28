// The route tree is shared by the browser router and route-matching tests.
export const workspaceRoutes = [
  { index: true, id: "home" },
  { path: "customers", children: [
    { index: true, id: "customers", handle: { section: "customers" } },
    { path: "new", id: "create-customer", handle: { section: "customers", record: true } },
    { path: ":customerId", children: [
      { index: true, id: "customer-details", handle: { section: "customers", record: true } },
      { path: "edit", id: "edit-customer", handle: { section: "customers", record: true } },
      { path: "sites", children: [
        { path: "new", id: "create-site", handle: { section: "customers", record: true } },
        { path: ":siteId", children: [
          { index: true, id: "site-details", handle: { section: "customers", record: true } },
          { path: "edit", id: "edit-site", handle: { section: "customers", record: true } },
        ] },
      ] },
    ] },
  ] },
  { path: "jobs", children: [
    { path: "new", id: "create-job", handle: { record: true } },
    { path: ":jobId", children: [
      { index: true, id: "job-details", handle: { record: true } },
      { path: "quote", id: "quote", handle: { record: true, documentType: "quote" } },
      { path: "invoice", id: "invoice", handle: { record: true, documentType: "invoice" } },
    ] },
  ] },
  { path: "maintenance", children: [
    { index: true, id: "maintenance", handle: { section: "maintenance" } },
    { path: "new", id: "create-maintenance", handle: { section: "maintenance", record: true } },
    { path: ":planId", children: [
      { index: true, id: "maintenance-details", handle: { section: "maintenance", record: true } },
      { path: "edit", id: "edit-maintenance", handle: { section: "maintenance", record: true } },
    ] },
  ] },
  { path: "invoices", id: "invoices", handle: { section: "invoices" } },
  { path: "map", id: "map", handle: { section: "map" } },
  { path: "settings", id: "settings", handle: { section: "settings" } },
  { path: "*", id: "fallback", handle: { section: "service-board" } },
];
