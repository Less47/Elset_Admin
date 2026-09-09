import CustomerWorkspace from "@/components/customers/CustomerWorkspace";
import CustomerFormPage from "@/components/customers/CustomerFormPage";
import SiteWorkspace from "@/components/sites/SiteWorkspace";
import { RecordWorkspace, WorkspaceMessage } from "@/components/workspace/RecordWorkspace";
import { buildCustomerSites } from "@/lib/app-support";

export default function CustomerPages({ route, navigation, actions, data, canManageBusiness, backLabel }) {
  const customer = data.customers.find((entry) => entry.id === route.customerId);
  const jobs = customer ? data.jobs.filter((job) => job.customerId === customer.id) : [];
  const sites = customer ? buildCustomerSites(customer, jobs) : [];
  const site = sites.find((entry) => entry.id === route.siteKey || entry.siteProfileId === route.siteKey);
  const siteRoute = ["site-details", "edit-site", "create-site"].includes(route.type);
  const title = siteRoute ? "Site Profile" : "Customer";
  if (!canManageBusiness || (route.type !== "create-customer" && !customer) || (siteRoute && route.type !== "create-site" && !site)) {
    return <RecordWorkspace title={title} backLabel={backLabel} onBack={() => navigation.closeWorkspace({ force: true })}>
      <WorkspaceMessage tone="error">{!canManageBusiness ? "You do not have permission to view customer records." : !customer ? "This customer could not be found." : "This site could not be found."}</WorkspaceMessage>
    </RecordWorkspace>;
  }
  if (route.type === "create-customer" || route.type === "edit-customer") {
    const editing = route.type === "edit-customer";
    return <CustomerFormPage key={route.path} customer={editing ? customer : null} backLabel={editing ? "Customer Profile" : "Customers"}
      onCancel={navigation.closeWorkspace} registerNavigationBlocker={navigation.registerBlocker}
      onOpenSite={(entry) => navigation.navigateToSite(customer.id, entry.siteProfileId || entry.id)}
      onSave={(draft) => editing ? actions.handleUpdateCustomer(customer.id, draft) : actions.handleCreateCustomer(draft)}
      onSaved={(saved) => editing ? navigation.closeWorkspace({ force: true }) : navigation.navigateToCustomer(saved.id, { replace: true, force: true })} />;
  }
  if (siteRoute) {
    return <SiteWorkspace key={route.path} customer={customer} site={site} jobs={jobs} editing={route.type !== "site-details"}
      tab={route.tab} onTabChange={navigation.setWorkspaceTab} backLabel={route.type === "edit-site" ? "Site Profile" : backLabel}
      onBack={navigation.closeWorkspace} onEdit={() => navigation.navigateToSite(customer.id, route.siteKey, { edit: true })}
      onOpenCustomer={() => actions.handleOpenCustomerProfile(customer.id)} onOpenJob={actions.handleOpenJob}
      onSaveSite={actions.handleSaveSiteProfile} registerNavigationBlocker={navigation.registerBlocker}
      onSaved={(saved) => route.type === "create-site"
        ? navigation.navigateToSite(customer.id, saved.id, { replace: true, force: true })
        : navigation.closeWorkspace({ force: true })}
      onDeleteSiteProfile={async (customerId, entry) => { if (await actions.handleDeleteSiteProfile(customerId, entry)) navigation.closeWorkspace({ force: true }); }} />;
  }
  return <CustomerWorkspace key={customer.id} customer={customer} jobs={jobs} tab={route.tab} onTabChange={navigation.setWorkspaceTab} backLabel={backLabel}
    onBack={navigation.closeWorkspace} onEdit={() => navigation.navigateToCustomer(customer.id, { edit: true })}
    onOpenSite={(entry) => actions.handleOpenSiteProfile(customer.id, entry.siteProfileId || entry.id)}
    onCreateSite={() => actions.handleCreateSiteProfile(customer.id)} onOpenJob={actions.handleOpenJob}
    onDelete={async () => { if (await actions.handleDeleteCustomer(customer.id)) navigation.navigateToSection("customers"); }} />;
}
