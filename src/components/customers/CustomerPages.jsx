import { useLocation, useMatches, useNavigate, useOutletContext, useParams } from "react-router";
import { recordLinkState } from "@/lib/record-link-state";
import CustomerWorkspace from "@/components/customers/CustomerWorkspace";
import CustomerFormPage from "@/components/customers/CustomerFormPage";
import SiteWorkspace from "@/components/sites/SiteWorkspace";
import { RecordWorkspace, WorkspaceMessage } from "@/components/workspace/RecordWorkspace";
import { buildCustomerSites, normalizeSiteAddress } from "@/lib/app-support";

export default function CustomerPages() {
  const { workspaceActions: actions, data, session } = useOutletContext();
  const { canManageBusiness } = session;
  const { customerId, siteId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const match = useMatches().at(-1);
  const mode = match.id;
  const customerPath = `/customers/${encodeURIComponent(customerId || "")}`;
  const sitePath = `${customerPath}/sites/${encodeURIComponent(siteId || "")}`;
  const parentPath = mode === "edit-site" ? sitePath
    : ["site-details", "create-site", "edit-customer"].includes(mode) ? customerPath : "/customers";
  const backLabel = location.state?.returnTo?.label || (mode === "edit-site" ? "Site Profile" : parentPath === customerPath ? "Customer Profile" : "Customers");
  const onBack = () => navigate(location.state?.returnTo ? -1 : parentPath, { replace: !location.state?.returnTo });
  const linkState = recordLinkState(location, match, data.jobs);
  const tab = location.state?.tab || "overview";
  const setTab = (tab) => navigate(location.pathname + location.search, { replace: true, preventScrollReset: true, state: { ...location.state, tab } });
  const customer = data.customers.find((entry) => entry.id === customerId);
  const jobs = customer ? data.jobs.filter((job) => job.customerId === customer.id) : [];
  const sites = customer ? buildCustomerSites(customer, jobs) : [];
  const site = sites.find((entry) => entry.id === siteId || entry.siteProfileId === siteId);
  const contracts = (data.maintenancePlans || []).filter((plan) => plan.customerId === customer?.id);
  const siteContracts = site ? contracts.filter((plan) => plan.siteId ? plan.siteId === site.siteProfileId
    : normalizeSiteAddress(plan.siteAddress).toLowerCase() === normalizeSiteAddress(site.address).toLowerCase()) : [];
  const siteRoute = ["site-details", "edit-site", "create-site"].includes(mode);
  const title = siteRoute ? "Site Profile" : "Customer";
  if (!canManageBusiness || (mode !== "create-customer" && !customer) || (siteRoute && mode !== "create-site" && !site)) {
    return <RecordWorkspace title={title} backLabel={backLabel} onBack={() => onBack()}>
      <WorkspaceMessage tone="error">{!canManageBusiness ? "You do not have permission to view customer records." : !customer ? "This customer could not be found." : "This site could not be found."}</WorkspaceMessage>
    </RecordWorkspace>;
  }
  if (mode === "create-customer" || mode === "edit-customer") {
    const editing = mode === "edit-customer";
    return <CustomerFormPage key={location.pathname} customer={editing ? customer : null} backLabel={editing ? "Customer Profile" : "Customers"}
      onCancel={onBack}
      onOpenSite={(entry) => navigate(`${customerPath}/sites/${encodeURIComponent(entry.siteProfileId || entry.id)}`, { state: linkState })}
      onSave={(draft) => editing ? actions.handleUpdateCustomer(customer.id, draft) : actions.handleCreateCustomer(draft)}
      onSaved={(saved) => editing ? onBack() : navigate(`/customers/${encodeURIComponent(saved.id)}`, { replace: true, state: location.state })} />;
  }
  if (siteRoute) {
    return <SiteWorkspace key={location.pathname} customer={customer} site={site} jobs={jobs} editing={mode !== "site-details"}
      maintenancePlans={siteContracts} onOpenPlan={actions.handleOpenMaintenancePlan}
      tab={tab} onTabChange={setTab} backLabel={mode === "edit-site" ? "Site Profile" : backLabel}
      onBack={onBack} onEdit={() => navigate(`${sitePath}/edit`, { state: linkState })}
      onOpenCustomer={() => actions.handleOpenCustomerProfile(customer.id)} onOpenJob={actions.handleOpenJob}
      onSaveSite={actions.handleSaveSiteProfile}
      onSaved={(saved) => mode === "create-site"
        ? navigate(`${customerPath}/sites/${encodeURIComponent(saved.id)}`, { replace: true, state: location.state })
        : onBack()}
      onDeleteSiteProfile={async (customerId, entry) => { if (await actions.handleDeleteSiteProfile(customerId, entry)) onBack(); }} />;
  }
  return <CustomerWorkspace key={customer.id} customer={customer} jobs={jobs} tab={tab} onTabChange={setTab} backLabel={backLabel}
    maintenancePlans={contracts} onOpenPlan={actions.handleOpenMaintenancePlan}
    accountJobs={data.jobs}
    onOpenInvoice={async (jobId) => {
      const job = data.jobs.find((entry) => entry.id === jobId && entry.customerId === customer.id && entry.invoice);
      if (job) navigate(`/jobs/${encodeURIComponent(jobId)}/invoice`, { state: linkState });
      // A live summary can discover an invoice created in another session.
      // Reload the existing editor route to hydrate that newly available record.
      else {
        await navigate(`/jobs/${encodeURIComponent(jobId)}/invoice`, { state: linkState });
        window.location.reload();
      }
    }}
    onViewInvoices={() => navigate(`/invoices?customerId=${encodeURIComponent(customer.id)}`)}
    onBack={onBack} onEdit={() => navigate(`${customerPath}/edit`, { state: linkState })}
    onOpenSite={(entry) => actions.handleOpenSiteProfile(customer.id, entry.siteProfileId || entry.id)}
    onCreateSite={() => actions.handleCreateSiteProfile(customer.id)} onOpenJob={actions.handleOpenJob}
    onDelete={async () => { if (await actions.handleDeleteCustomer(customer.id)) navigate("/customers"); }} />;
}
