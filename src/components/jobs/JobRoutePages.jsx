import { useLocation, useMatches, useNavigate, useOutletContext, useParams } from "react-router";
import CreateJobPage from "./CreateJobPage";
import JobDetailsPage from "./JobDetailsPage";
import DocumentEditor from "@/components/documents/DocumentEditor";
import { RecordWorkspace, WorkspaceMessage } from "@/components/workspace/RecordWorkspace";
import { readFileAsDataUrl } from "@/lib/app-support";

export function CreateJobRoute() {
  const { session, data, workspaceActions } = useOutletContext();
  const location = useLocation();
  const navigate = useNavigate();
  const backLabel = location.state?.returnTo?.label || "Service Board";
  const onBack = () => navigate(location.state?.returnTo ? -1 : "/", { replace: !location.state?.returnTo });
  return session.canManageBusiness
      ? (
          <CreateJobPage
            backLabel={backLabel}
            customers={data.customers}
            jobs={data.jobs}
            staff={data.staff}
            onCancel={onBack}
            onCreated={(job) => {
              navigate(`/jobs/${encodeURIComponent(job.id)}`, { replace: true, state: location.state });
            }}
            onSave={workspaceActions.createJob}
          />
        )
      : (
          <RecordWorkspace backLabel={backLabel} eyebrow="Jobs" title="Create Job" onBack={() => onBack()}>
            <WorkspaceMessage tone="error">You do not have permission to create jobs.</WorkspaceMessage>
          </RecordWorkspace>
        );
}

export function JobDetailsRoute() {
  const { session, data, workspaceActions, workspaceViewModel, workspaceAddons } = useOutletContext();
  const { jobId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const backLabel = location.state?.returnTo?.label || "Service Board";
  const onBack = () => navigate(location.state?.returnTo ? -1 : "/", { replace: !location.state?.returnTo });
  const handleJobPhotoUpload = async (files) => {
    if (!workspaceViewModel.selectedFreshJob) return false;

    try {
      const photos = await Promise.all(
        files.map(async (file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          url: await readFileAsDataUrl(file),
        }))
      );
      return workspaceActions.handleAddJobPhotos(workspaceViewModel.selectedFreshJob.id, photos);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to read the selected image files.");
      return false;
    }
  };

  return (<JobDetailsPage
            addons={workspaceAddons.addons}
            fetchWithAuth={session.fetchWithAuth}
            onAddonDisabled={workspaceAddons.refresh}
            key={workspaceViewModel.selectedFreshJob?.id || `missing-${jobId}`}
            backLabel={backLabel}
            canDeleteJob={session.canManageBusiness}
            canEditJob={session.canManageBusiness}
            customer={workspaceViewModel.selectedFreshCustomer}
            customerJobs={workspaceViewModel.selectedFreshCustomerJobs}
            job={workspaceViewModel.selectedFreshJob}
            staff={data.staff}
            showCommercialDocuments={session.canManageBusiness}
            onBack={onBack}
            onStatusChange={(status) => workspaceViewModel.selectedFreshJob
              ? workspaceActions.handleStatusChange(workspaceViewModel.selectedFreshJob.id, status)
              : false}
            onUpdateJobDetails={(updates) => workspaceViewModel.selectedFreshJob
              ? workspaceActions.handleUpdateJobDetails(workspaceViewModel.selectedFreshJob.id, updates)
              : false}
            onDeleteJob={() => workspaceViewModel.selectedFreshJob
              ? workspaceActions.handleDeleteJob(workspaceViewModel.selectedFreshJob.id)
              : false}
            onDeleted={() => onBack()}
            onOpenCustomerProfile={session.canManageBusiness ? workspaceActions.handleOpenCustomerProfile : null}
            onOpenSiteProfile={session.canManageBusiness ? workspaceActions.handleOpenSiteProfile : null}
            onOpenDocument={session.canManageBusiness ? (type) => {
              if (workspaceViewModel.selectedFreshJob) workspaceActions.handleOpenDoc(workspaceViewModel.selectedFreshJob, type);
            } : null}
            onOpenSentDocument={session.canManageBusiness ? (type) => {
              if (workspaceViewModel.selectedFreshJob) workspaceActions.handleOpenSentDocumentCopy(workspaceViewModel.selectedFreshJob, type);
            } : null}
            onAddNote={(text) => workspaceViewModel.selectedFreshJob
              ? workspaceActions.handleAddJobNote(workspaceViewModel.selectedFreshJob.id, text, workspaceViewModel.noteAuthor)
              : false}
            onAddPhotos={handleJobPhotoUpload}
            onDeletePhoto={(photo) => {
              if (!workspaceViewModel.selectedFreshJob) return false;
              const photoLabel = photo?.name || "this photo";
              if (!window.confirm(`Delete ${photoLabel} from this job? This cannot be undone.`)) return false;
              return workspaceActions.handleDeleteJobPhoto(workspaceViewModel.selectedFreshJob.id, photo);
            }}
          />);
}

export function DocumentRoute() {
  const { session, data, workspaceActions, workspaceAddons, setData, setInvoiceNotice, isSendingDocument } = useOutletContext();
  const { jobId } = useParams();
  const documentType = useMatches().at(-1).handle.documentType;
  const location = useLocation();
  const navigate = useNavigate();
  const routeSelectedJob = data.jobs.find((job) => job.id === jobId);
  const backLabel = location.state?.returnTo?.label || `Job #${routeSelectedJob?.jobNumber || "Details"}`;
  const onBack = () => navigate(location.state?.returnTo ? -1 : `/jobs/${encodeURIComponent(jobId)}`, { replace: !location.state?.returnTo });
  return session.canManageBusiness && routeSelectedJob
          ? <DocumentEditor
              addons={workspaceAddons.addons}
              fetchWithAuth={session.fetchWithAuth}
              key={`${jobId}-${documentType}`}
              job={routeSelectedJob}
              type={documentType}
              backLabel={location.state?.returnTo?.label || `Job #${routeSelectedJob.jobNumber}`}
              onBack={onBack}
              onSave={(doc, options) => workspaceActions.handleSaveDocument(routeSelectedJob.id, documentType, doc, options)}
              onInvoiceReconciled={(invoice) => setData((current) => ({ ...current, jobs: current.jobs.map((job) => job.id === routeSelectedJob.id ? { ...job, invoice } : job) }))}
              onPreviewDocument={workspaceActions.handlePreviewDocument}
              onSendDocument={workspaceActions.handleSendDocument}
              onOpenSentDocument={() => workspaceActions.handleOpenSentDocumentCopy(routeSelectedJob, documentType)}
              onDeleteInvoice={(options) => workspaceActions.handleDeleteInvoice(routeSelectedJob.id, options)}
              onInvoiceDeleted={() => {
                setInvoiceNotice("Invoice moved to Recycle Bin");
                navigate("/invoices", { replace: true });
              }}
              isSendingDocument={isSendingDocument}
            />
          : <RecordWorkspace title={documentType === "quote" ? "Quote" : "Invoice"} backLabel={backLabel} onBack={() => onBack()}>
              <WorkspaceMessage tone="error">{session.canManageBusiness ? "This job could not be found." : "You do not have permission to edit this document."}</WorkspaceMessage>
            </RecordWorkspace>;
}
