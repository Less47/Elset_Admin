import CustomerCreateDialog from "@/components/customers/CustomerCreateDialog";
import CustomerProfileDialog from "@/components/customers/CustomerProfileDialog";
import SiteProfileDialog from "@/components/sites/SiteProfileDialog";

export default function WorkspaceDialogs({ auth, chrome, selection, actions }) {
  const { canManageBusiness } = auth;
  const {
    customerCreateOpen,
    customerProfileOpen,
    setCustomerCreateOpen,
    setCustomerProfileOpen,
    setSelectedCustomerId,
    setSelectedSiteContext,
    setSiteProfileOpen,
    siteProfileOpen,
  } = chrome;
  const {
    selectedCustomer,
    selectedCustomerJobs,
    selectedSite,
    selectedSiteCustomer,
    selectedSiteJobs,
  } = selection;
  const {
    handleCreateCustomer,
    handleDeleteCustomer,
    handleDeleteSiteProfile,
    handleOpenJob,
    handleOpenSiteProfile,
    handleSaveSiteProfile,
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

    </>
  );
}
