import { ContactList } from "@/components/shared/ContactAssignmentsEditor";
import { getCustomerRelatedContacts } from "@/lib/contact-model";
import { useLayoutEffect, useRef, useState } from "react";
import CustomerAccount from "./CustomerAccount";
import ProfileMaintenanceContracts from "@/components/maintenance/ProfileMaintenanceContracts";
import { customerPostalFields } from "@/lib/customer-profile";
import { EmptyState } from "@/components/shared/EmptyState";
import { MobileRecordList, MobileRecordCard, MobileRecordHeader, MobileRecordBody, MobileRecordActions } from "@/components/shared/MobileRecordList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RecordWorkspace } from "@/components/workspace/RecordWorkspace";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { buildCustomerSites, formatCustomerType, formatSiteType, formatDate,   toTimestamp } from "@/lib/app-support";
import "./CustomerWorkspace.css";

export function CustomerInfo({ label, children }) {
  return <div className="min-w-0"><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-0.5 text-xs font-medium leading-5 text-foreground [overflow-wrap:anywhere]">{children || "Not set"}</dd></div>;
}

export function CustomerJobHistory({ jobs, onOpenJob }) {
  if (!jobs.length) return <EmptyState title="No jobs recorded yet" text="Jobs for this customer will appear here." />;
  return <MobileRecordList label="Job history">{[...jobs].sort((a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt)).map((job) => <MobileRecordCard key={job.id} recordId={job.id} labelledBy={`customer-job-${job.id}`}>
    <MobileRecordHeader><div className="min-w-0"><p className="text-xs text-muted-foreground">Job #{job.jobNumber}</p><h3 id={`customer-job-${job.id}`} className="font-semibold [overflow-wrap:anywhere]">{job.title}</h3></div><Badge variant="secondary" className="shrink-0">{job.status}</Badge></MobileRecordHeader>
    <MobileRecordBody><p className="line-clamp-2">{job.description}</p><p>Site: {job.jobAddress || "Not set"}</p><p className="text-xs">Latest activity: {formatDate(job.updatedAt)}</p></MobileRecordBody>
    <MobileRecordActions className="customer-record-actions"><Button type="button" variant="outline" onClick={() => onOpenJob(job)}>Open Job #{job.jobNumber}</Button></MobileRecordActions>
  </MobileRecordCard>)}</MobileRecordList>;
}

function CustomerSection({ name, title, count, summary, action, description = "", children, scrollable = false }) {
  return (
        <section className="customer-section" data-customer-section={name} aria-labelledby={scrollable ? undefined : `customer-section-${name}`}
          aria-label={scrollable ? "Customer job history" : undefined} tabIndex={scrollable ? 0 : undefined}>
          <header className="customer-section-header">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 id={`customer-section-${name}`} className="min-w-0 text-base font-semibold leading-5 [overflow-wrap:anywhere]">{title}</h2>
              {count !== undefined ? <span className="customer-section-count">{count}</span> : null}
              {summary}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </header>
          <div className="customer-section-body">
            {description ? <p className="customer-section-description text-xs text-text-secondary">{description}</p> : null}
            {children}
          </div>
        </section>
  );
}

function CustomerDetailsSection({ customer, deleting, onDelete, desktop }) {
  return (
    <CustomerSection name="details" title="Customer details">
        <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2">
          <CustomerInfo label="Customer / company name">{customer.name}</CustomerInfo>
          <CustomerInfo label="Customer type">{formatCustomerType(customer.customerType)}</CustomerInfo>
          <CustomerInfo label="Account email">{customer.email}</CustomerInfo>
          <CustomerInfo label="Account phone">{customer.phone}</CustomerInfo>
          <CustomerInfo label="Primary address">{customer.address}</CustomerInfo>
          <CustomerInfo label="Postal address">{customerPostalFields(customer).postalAddress}</CustomerInfo>
          <CustomerInfo label="Created">{formatDate(customer.createdAt)}</CustomerInfo>
        </dl>
        {!desktop ? <div className="mt-3 flex justify-end border-t pt-3">
          <Button type="button" variant="outline" className="border-status-danger-border text-status-danger hover:bg-status-danger-surface" disabled={deleting} onClick={onDelete}>Delete Customer</Button>
        </div> : null}
    </CustomerSection>
  );
}

function CustomerSitesSection({ sites, onOpenSite, onCreateSite, desktop }) {
  return (
    <CustomerSection name="sites" title="Sites" count={sites.length}
      action={<Button type="button" className={desktop ? "h-7" : ""} size={desktop ? "sm" : "default"} onClick={onCreateSite}>Add Site</Button>}>
        {!sites.length ? <p className="text-sm text-text-secondary">No sites saved yet. Add a site for this customer.</p> : (
          <MobileRecordList label="Customer sites">{sites.map((site) => (
            <MobileRecordCard key={site.id} recordId={site.id} labelledBy={`customer-site-${site.id}`}>
              <MobileRecordHeader>
                <div className="min-w-0"><h3 id={`customer-site-${site.id}`} className="font-semibold [overflow-wrap:anywhere]">{site.label || site.address}</h3>{site.label ? <p className="text-sm [overflow-wrap:anywhere]">{site.address}</p> : null}</div>
                {site.isPrimary ? <Badge className="shrink-0">Primary</Badge> : null}
              </MobileRecordHeader>
              <MobileRecordBody><p>{formatSiteType(site.siteType)} · {site.openJobCount || 0} open jobs</p>{site.ocNumber ? <p>OC {site.ocNumber}</p> : null}{site.accessNotes ? <p className="whitespace-pre-wrap">{site.accessNotes}</p> : null}</MobileRecordBody>
              <MobileRecordActions className="customer-record-actions"><Button type="button" variant="outline" onClick={() => onOpenSite(site)}>Open Site Profile</Button></MobileRecordActions>
            </MobileRecordCard>
          ))}</MobileRecordList>
        )}
    </CustomerSection>
  );
}

function CustomerContactsSection({ contacts }) {
  return <CustomerSection name="contacts" title="Contacts" count={contacts.length}>
    <ContactList contacts={contacts} customer />
  </CustomerSection>;
}

function CustomerJobsSection({ jobs, onOpenJob, desktop }) {
  const openJobs = jobs.filter((job) => job.status !== "Completed").length;
  return (
    <CustomerSection scrollable={desktop} name="jobs" title="Job History" summary={<span className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-normal text-text-secondary" data-customer-job-stats><span>{jobs.length} total jobs</span><span>{openJobs} open</span><span>{jobs.length - openJobs} completed</span></span>} description={jobs.length ? "Most recent activity first." : ""}>
        {jobs.length ? <CustomerJobHistory jobs={jobs} onOpenJob={onOpenJob} /> : <p className="text-sm text-text-secondary">No jobs recorded yet.</p>}
    </CustomerSection>
  );
}

export default function CustomerWorkspace({ customer, jobs, accountJobs = jobs, maintenancePlans = [], onOpenPlan, onOpenInvoice, onViewInvoices, tab = "overview", onTabChange, backLabel, onBack, onEdit, onDelete, onOpenSite, onCreateSite, onOpenJob }) {
  const desktop = useMediaQuery("(min-width: 64rem)");
  const [deleting, setDeleting] = useState(false);
  const workspaceRef = useRef(null);
  const sites = buildCustomerSites(customer, jobs);
  const contacts = getCustomerRelatedContacts(customer);
  const tabValue = ["overview", "sites", "contacts", "account", "maintenance", "jobs"].includes(tab) ? tab : "overview";
  useLayoutEffect(() => {
    if (!desktop) return;
    const workspace = workspaceRef.current;
    const header = workspace.closest(".record-workspace").querySelector(".record-workspace-header");
    const strip = workspace.querySelector(".record-tab-strip");
    const footer = workspace.querySelector("[data-customer-danger-zone]");
    const update = () => workspace.style.setProperty("--customer-profile-chrome-height", `${header.getBoundingClientRect().bottom + strip.getBoundingClientRect().height + footer.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    [header, strip, footer].forEach((element) => observer.observe(element));
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      workspace.style.removeProperty("--customer-profile-chrome-height");
    };
  }, [desktop]);
  const deleteCustomer = async () => {
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); }
  };
  const sections = {
    overview: <CustomerDetailsSection desktop={desktop} customer={customer} deleting={deleting} onDelete={deleteCustomer} />,
    sites: <CustomerSitesSection desktop={desktop} sites={sites} onOpenSite={onOpenSite} onCreateSite={onCreateSite} />,
    maintenance: <CustomerSection name="maintenance" title="Maintenance contracts" count={maintenancePlans.length}><ProfileMaintenanceContracts plans={maintenancePlans} jobs={jobs} onOpenPlan={onOpenPlan} /></CustomerSection>,
    contacts: <CustomerContactsSection contacts={contacts} />,
    account: <CustomerSection name="account" title="Account"><CustomerAccount customerId={customer.id} jobs={accountJobs} onOpenInvoice={onOpenInvoice} onViewInvoices={onViewInvoices} /></CustomerSection>,
    jobs: <CustomerJobsSection desktop={desktop} jobs={jobs} onOpenJob={onOpenJob} />,
  };

  return (
    <RecordWorkspace backLabel={backLabel} eyebrow="Customers" title={customer.name} subtitle={[customer.email, customer.phone].filter(Boolean).join(" · ")}
      status={<Badge className="bg-card/90 text-foreground">{formatCustomerType(customer.customerType)}</Badge>}
      onBack={() => onBack()} maxWidth="max-w-none" headerActions={<Button type="button" className="h-11" onClick={onEdit}>Edit Customer</Button>}>
      <div ref={workspaceRef} className="min-w-0 text-sm" data-customer-workspace>
          <Tabs value={desktop ? (tabValue === "maintenance" ? "maintenance" : "overview") : tabValue} onValueChange={onTabChange} className="customer-workspace-tabs min-w-0 gap-0">
            <div className="record-tab-strip min-w-0 overflow-x-auto">
              <TabsList className="record-workspace-tabs h-auto min-h-11 w-max justify-start gap-1 bg-transparent" aria-label="Customer sections">
                {(desktop ? [['overview', 'Overview', null], ['maintenance', 'Maintenance', maintenancePlans.length]]
                  : [['overview', 'Overview', null], ['sites', 'Sites', sites.length], ['contacts', 'Contacts', contacts.length], ['account', 'Account', null], ['maintenance', 'Maintenance', maintenancePlans.length], ['jobs', 'Job History', jobs.length]]).map(([value, label, count]) => (
                  <TabsTrigger key={value} value={value} className="min-h-11 flex-none px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{label}{count !== null ? <span className="text-xs opacity-75">{count}</span> : null}</TabsTrigger>
                ))}
              </TabsList>
            </div>
            <TabsContent value="overview" className="min-w-0">
              <div className="customer-workspace-grid">
                <div className="customer-workspace-column" data-customer-column="left">{sections.overview}{sections.contacts}</div>
                <div className="customer-workspace-column" data-customer-column="middle">{sections.account}{sections.sites}</div>
                <div className="customer-workspace-column" data-customer-column="right">{sections.jobs}</div>
              </div>
            </TabsContent>
            {Object.entries(sections).filter(([value]) => value !== "overview" && (!desktop || value === "maintenance")).map(([value, content]) => <TabsContent key={value} value={value} className="min-w-0">{content}</TabsContent>)}
          </Tabs>
          {desktop ? <section className="customer-danger-zone" aria-label="Destructive customer actions" data-customer-danger-zone>
            <span className="text-xs font-medium text-text-secondary">Danger zone</span>
            <Button type="button" variant="outline" className="border-status-danger-border text-status-danger hover:bg-status-danger-surface" disabled={deleting} onClick={deleteCustomer}>Delete Customer</Button>
          </section> : null}
      </div>
    </RecordWorkspace>
  );
}
