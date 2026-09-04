import CustomerCreateDialog from "@/components/customers/CustomerCreateDialog";
import CustomerProfileDialog from "@/components/customers/CustomerProfileDialog";
import DocumentEditor from "@/components/documents/DocumentEditor";
import SiteProfileDialog from "@/components/sites/SiteProfileDialog";

export default function WorkspaceDialogs({ auth, chrome, selection, actions }) {
  const { canManageBusiness } = auth;
  const {
    customerCreateOpen,
    customerProfileOpen,
    docEditorOpen,
    docType,
    isSendingDocument,
    setCustomerCreateOpen,
    setCustomerProfileOpen,
    setDocEditorOpen,
    setSelectedCustomerId,
    setSelectedSiteContext,
    setSiteProfileOpen,
    siteProfileOpen,
  } = chrome;
  const {
    selectedCustomer,
    selectedCustomerJobs,
    selectedFreshJob,
    selectedSite,
    selectedSiteCustomer,
    selectedSiteJobs,
  } = selection;
  const {
    handleCreateCustomer,
    handleDeleteCustomer,
    handleDeleteSiteProfile,
    handleOpenJob,
    handleOpenSentDocumentCopy,
    handleOpenSiteProfile,
    handlePreviewDocument,
    handleSaveDocument,
    handleSaveSiteProfile,
    handleSendDocument,
    handleUpdateCustomer,
  } = actions;

  return (
    <>
      {canManageBusiness ? (
        <>
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
            onSave={(doc) => (selectedFreshJob ? handleSaveDocument(selectedFreshJob.id, docType, doc) : false)}
          />
        </>
      ) : null}
    </>
  );
}
