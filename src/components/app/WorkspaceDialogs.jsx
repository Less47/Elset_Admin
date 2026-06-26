import CustomerCreateDialog from "@/components/customers/CustomerCreateDialog";
import CustomerProfileDialog from "@/components/customers/CustomerProfileDialog";
import DocumentEditor from "@/components/documents/DocumentEditor";
import JobDetailsDialog from "@/components/jobs/JobDetailsDialog";
import JobEditDialog from "@/components/jobs/JobEditDialog";
import JobFormDialog from "@/components/jobs/JobFormDialog";
import SiteProfileDialog from "@/components/sites/SiteProfileDialog";
import { normalizeDocument, readFileAsDataUrl } from "@/lib/app-support";

export default function WorkspaceDialogs({ auth, chrome, data, selection, supplierManualState, actions }) {
  const { canManageBusiness } = auth;
  const {
    customerCreateOpen,
    customerProfileOpen,
    docEditorOpen,
    docType,
    isSendingDocument,
    jobDetailsOpen,
    jobEditOpen,
    jobFormOpen,
    setCustomerCreateOpen,
    setCustomerProfileOpen,
    setDocEditorOpen,
    setJobDetailsOpen,
    setJobEditOpen,
    setJobFormOpen,
    setSelectedCustomerId,
    setSelectedSiteContext,
    setSiteProfileOpen,
    siteProfileOpen,
  } = chrome;
  const {
    noteAuthor,
    selectedCustomer,
    selectedCustomerJobs,
    selectedFreshCustomer,
    selectedFreshCustomerJobs,
    selectedFreshJob,
    selectedSite,
    selectedSiteCustomer,
    selectedSiteJobs,
    selectedSupplierManualMatches,
  } = selection;
  const {
    createJob,
    handleCreateCustomer,
    handleDeleteCustomer,
    handleDeleteJob,
    handleDeleteSiteProfile,
    handleOpenCustomerProfile,
    handleOpenDoc,
    handleOpenJob,
    handleOpenSentDocumentCopy,
    handleOpenSiteProfile,
    handlePreviewDocument,
    handleSaveSiteProfile,
    handleSendDocument,
    handleStatusChange,
    handleUpdateCustomer,
    handleUpdateJobDetails,
    updateJob,
  } = actions;

  return (
    <>
      {canManageBusiness ? (
        <>
          <JobFormDialog
            open={jobFormOpen}
            onOpenChange={setJobFormOpen}
            customers={data.customers}
            jobs={data.jobs}
            staff={data.staff}
            onSave={createJob}
          />

          <CustomerCreateDialog
            open={customerCreateOpen}
            onOpenChange={setCustomerCreateOpen}
            onSave={handleCreateCustomer}
          />

          <CustomerProfileDialog
            open={customerProfileOpen}
            onOpenChange={(open) => {
              setCustomerProfileOpen(open);
              if (!open) {
                setSelectedCustomerId(null);
              }
            }}
            customer={selectedCustomer}
            jobs={selectedCustomerJobs}
            onOpenJob={handleOpenJob}
            onOpenSiteProfile={handleOpenSiteProfile}
            onSaveCustomer={handleUpdateCustomer}
            onDeleteCustomer={handleDeleteCustomer}
          />

          <SiteProfileDialog
            open={siteProfileOpen}
            onOpenChange={(open) => {
              setSiteProfileOpen(open);
              if (!open) {
                setSelectedSiteContext(null);
              }
            }}
            customer={selectedSiteCustomer}
            site={selectedSite}
            jobs={selectedSiteJobs}
            onOpenJob={handleOpenJob}
            onSaveSite={handleSaveSiteProfile}
            onDeleteSiteProfile={handleDeleteSiteProfile}
          />
        </>
      ) : null}

      <JobDetailsDialog
        open={jobDetailsOpen}
        onOpenChange={setJobDetailsOpen}
        job={selectedFreshJob}
        customer={selectedFreshCustomer}
        onStatusChange={(status) => selectedFreshJob && handleStatusChange(selectedFreshJob.id, status)}
        onEditJob={() => {
          if (!canManageBusiness) return;
          setJobDetailsOpen(false);
          setJobEditOpen(true);
        }}
        onDeleteJob={() => selectedFreshJob && handleDeleteJob(selectedFreshJob.id)}
        canEditJob={canManageBusiness}
        canDeleteJob={canManageBusiness}
        showCommercialDocuments={canManageBusiness}
        supplierManualMatches={selectedSupplierManualMatches}
        supplierManualStatus={supplierManualState.status}
        supplierManualError={supplierManualState.error}
        onOpenCustomerProfile={canManageBusiness ? handleOpenCustomerProfile : null}
        onOpenSiteProfile={canManageBusiness ? handleOpenSiteProfile : null}
        onOpenDocument={canManageBusiness ? (type) => {
          if (!selectedFreshJob) return;
          setJobDetailsOpen(false);
          handleOpenDoc(selectedFreshJob, type);
        } : null}
        onOpenSentDocument={canManageBusiness ? (type) => {
          if (!selectedFreshJob) return;
          handleOpenSentDocumentCopy(selectedFreshJob, type);
        } : null}
        onAddNote={(text) => {
          if (!selectedFreshJob) return;

          updateJob(selectedFreshJob.id, {
            notes: [
              ...(selectedFreshJob.notes || []),
              { id: crypto.randomUUID(), author: noteAuthor, text, createdAt: new Date().toISOString() },
            ],
          });
        }}
        onAddPhotos={async (files) => {
          if (!selectedFreshJob) return;

          try {
            const photos = await Promise.all(
              files.map(async (file) => ({
                id: crypto.randomUUID(),
                name: file.name,
                url: await readFileAsDataUrl(file),
              }))
            );

            updateJob(selectedFreshJob.id, {
              photos: [...(selectedFreshJob.photos || []), ...photos],
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to read the selected image files.";
            window.alert(message);
          }
        }}
        onDeletePhoto={(photo) => {
          if (!selectedFreshJob) return;

          const photoLabel = photo?.name || "this photo";
          const confirmed = window.confirm(`Delete ${photoLabel} from this job? This cannot be undone.`);
          if (!confirmed) return;

          updateJob(selectedFreshJob.id, {
            photos: (selectedFreshJob.photos || []).filter((entry) => entry.id !== photo.id),
          });
        }}
      />

      {canManageBusiness ? (
        <>
          <DocumentEditor
            open={docEditorOpen}
            onOpenChange={setDocEditorOpen}
            job={selectedFreshJob}
            type={docType}
            isSendingDocument={isSendingDocument}
            onPreviewDocument={handlePreviewDocument}
            onSendDocument={handleSendDocument}
            onOpenSentDocument={() => selectedFreshJob && handleOpenSentDocumentCopy(selectedFreshJob, docType)}
            onSave={(doc) => {
              if (!selectedFreshJob) return;
              updateJob(selectedFreshJob.id, { [docType]: normalizeDocument(docType, doc) });
            }}
          />

          <JobEditDialog
            open={jobEditOpen}
            onOpenChange={setJobEditOpen}
            job={selectedFreshJob}
            customer={selectedFreshCustomer}
            customerJobs={selectedFreshCustomerJobs}
            staff={data.staff}
            onSave={(updates) => selectedFreshJob && handleUpdateJobDetails(selectedFreshJob.id, updates)}
          />
        </>
      ) : null}
    </>
  );
}
