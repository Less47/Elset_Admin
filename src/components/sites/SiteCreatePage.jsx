import { Navigate, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router";
import { RecordWorkspace, WorkspaceMessage } from "@/components/workspace/RecordWorkspace";
import SiteFormPage from "./SiteFormPage";

export function LegacySiteCreateRedirect() {
  const { customerId } = useParams();
  const location = useLocation();
  return <Navigate to={`/sites/new?customerId=${encodeURIComponent(customerId)}`} replace state={location.state} />;
}

export default function SiteCreatePage() {
  const { workspaceActions: actions, data, session } = useOutletContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialCustomerId = searchParams.get("customerId") || "";
  const initialCustomer = data.customers.find((customer) => customer.id === initialCustomerId);
  const parentPath = initialCustomer ? `/customers/${encodeURIComponent(initialCustomer.id)}` : "/sites";
  const backLabel = location.state?.returnTo?.label || (initialCustomer ? "Customer Profile" : "Sites");
  const onCancel = () => navigate(location.state?.returnTo ? -1 : parentPath, { replace: !location.state?.returnTo });
  if (!session.canManageBusiness || (initialCustomerId && !initialCustomer)) return <RecordWorkspace backLabel={backLabel} eyebrow="Sites" title="New Site" onBack={onCancel} maxWidth="max-w-none">
    <WorkspaceMessage tone="error">{!session.canManageBusiness ? "You do not have permission to view customer records." : "This customer could not be found."}</WorkspaceMessage>
  </RecordWorkspace>;
  return <SiteFormPage key={location.key} customers={data.customers} contacts={data.contacts} initialCustomerId={initialCustomerId} backLabel={backLabel} onCancel={onCancel}
    onSave={(customerId, draft) => actions.handleSaveSiteProfile(customerId, draft, "", { throwOnError: true })}
    onSaved={(saved, customerId) => navigate(`/customers/${encodeURIComponent(customerId)}/sites/${encodeURIComponent(saved.id)}`, { replace: true, state: location.state })} />;
}
