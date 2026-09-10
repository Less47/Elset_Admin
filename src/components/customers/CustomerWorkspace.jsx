import { useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { MobileRecordList, MobileRecordCard, MobileRecordHeader, MobileRecordBody, MobileRecordActions } from "@/components/shared/MobileRecordList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RecordWorkspace, RECORD_WORKSPACE_WIDE_MAX_WIDTH, WorkspaceSection } from "@/components/workspace/RecordWorkspace";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { buildCustomerSites, formatCustomerType, formatSiteType, formatDate, getContactDisplayName, getCustomerContacts, toTimestamp } from "@/lib/app-support";
import "./CustomerWorkspace.css";

export function CustomerInfo({ label, children }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium text-foreground [overflow-wrap:anywhere]">{children || "Not set"}</dd></div>;
}

export function CustomerJobHistory({ jobs, onOpenJob }) {
  if (!jobs.length) return <EmptyState title="No jobs recorded yet" text="Jobs for this customer will appear here." />;
  return <MobileRecordList label="Job history">{[...jobs].sort((a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt)).map((job) => <MobileRecordCard key={job.id} recordId={job.id} labelledBy={`customer-job-${job.id}`}>
    <MobileRecordHeader><div className="min-w-0"><p className="text-xs text-muted-foreground">Job #{job.jobNumber}</p><h3 id={`customer-job-${job.id}`} className="font-semibold [overflow-wrap:anywhere]">{job.title}</h3></div><Badge variant="secondary" className="shrink-0">{job.status}</Badge></MobileRecordHeader>
    <MobileRecordBody><p className="line-clamp-2">{job.description}</p><p>Site: {job.jobAddress || "Not set"}</p><p className="text-xs">Latest activity: {formatDate(job.updatedAt)}</p></MobileRecordBody>
    <MobileRecordActions><Button type="button" variant="outline" onClick={() => onOpenJob(job)}>Open Job #{job.jobNumber}</Button></MobileRecordActions>
  </MobileRecordCard>)}</MobileRecordList>;
}

function CustomerSection({ desktop, name, title, count, action, description = "", children, panel = false }) {
  return (
    <div className="min-w-0" data-customer-section={name}>
      {desktop ? (
        <section className="customer-section-panel" aria-labelledby={`customer-section-${name}`}>
          <header className="customer-section-header">
            <div className="flex min-w-0 items-center gap-2">
              <h2 id={`customer-section-${name}`} className="min-w-0 text-base font-semibold leading-5 [overflow-wrap:anywhere]">{title}</h2>
              {count !== undefined ? <span className="customer-section-count">{count}</span> : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </header>
          <div className="customer-section-body">
            {description ? <p className="mb-2 text-xs text-text-secondary">{description}</p> : null}
            {children}
          </div>
        </section>
      ) : (
        <WorkspaceSection title={<>{title}{count !== undefined ? <> <SectionCount>{count}</SectionCount></> : null}</>} trailing={action} description={description} panel={panel}>
          {children}
        </WorkspaceSection>
      )}
    </div>
  );
}

function CustomerDetailsSection({ customer, jobs, deleting, onDelete, desktop }) {
  const openJobs = jobs.filter((job) => job.status !== "Completed").length;
  return (
    <CustomerSection desktop={desktop} name="details" title="Customer details" panel>
        <dl className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
          <CustomerInfo label="Customer / company name">{customer.name}</CustomerInfo>
          <CustomerInfo label="Customer type">{formatCustomerType(customer.customerType)}</CustomerInfo>
          <CustomerInfo label="Account email">{customer.email}</CustomerInfo>
          <CustomerInfo label="Account phone">{customer.phone}</CustomerInfo>
          <CustomerInfo label="Primary address">{customer.address}</CustomerInfo>
          <CustomerInfo label="Created">{formatDate(customer.createdAt)}</CustomerInfo>
        </dl>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-sm">
          <span>{jobs.length} total jobs</span><span>{openJobs} open</span><span>{jobs.length - openJobs} completed</span>
        </div>
        {!desktop ? <div className="mt-3 flex justify-end border-t pt-3">
          <Button type="button" variant="outline" className="border-status-danger-border text-status-danger hover:bg-status-danger-surface" disabled={deleting} onClick={onDelete}>Delete Customer</Button>
        </div> : null}
    </CustomerSection>
  );
}

function SectionCount({ children }) {
  return <span className="ml-1 text-xs font-normal text-text-secondary">{children}</span>;
}

function CustomerSitesSection({ sites, onOpenSite, onCreateSite, desktop }) {
  return (
    <CustomerSection desktop={desktop} name="sites" title="Sites" count={sites.length}
      action={<Button type="button" className={desktop ? "h-7" : ""} size={desktop ? "sm" : "default"} onClick={onCreateSite}>Add Site</Button>}>
        {!sites.length ? <p className="text-sm text-text-secondary">No sites saved yet. Add a site for this customer.</p> : (
          <MobileRecordList label="Customer sites">{sites.map((site) => (
            <MobileRecordCard key={site.id} recordId={site.id} labelledBy={`customer-site-${site.id}`}>
              <MobileRecordHeader>
                <div className="min-w-0"><h3 id={`customer-site-${site.id}`} className="font-semibold [overflow-wrap:anywhere]">{site.label || site.address}</h3>{site.label ? <p className="text-sm [overflow-wrap:anywhere]">{site.address}</p> : null}</div>
                {site.isPrimary ? <Badge className="shrink-0">Primary</Badge> : null}
              </MobileRecordHeader>
              <MobileRecordBody><p>{formatSiteType(site.siteType)} · {site.openJobCount || 0} open jobs</p>{site.ocNumber ? <p>OC {site.ocNumber}</p> : null}{site.accessNotes ? <p className="whitespace-pre-wrap">{site.accessNotes}</p> : null}</MobileRecordBody>
              <MobileRecordActions><Button type="button" variant="outline" onClick={() => onOpenSite(site)}>Open Site Profile</Button></MobileRecordActions>
            </MobileRecordCard>
          ))}</MobileRecordList>
        )}
    </CustomerSection>
  );
}

function CustomerContactsSection({ customer, contacts, sites, desktop }) {
  return (
    <CustomerSection desktop={desktop} name="contacts" title="Contacts" count={contacts.length}>
        {!contacts.length ? <p className="text-sm text-text-secondary">No contacts saved yet. Edit this customer to add contacts.</p> : (
          <MobileRecordList label="Customer contacts">{contacts.map((contact) => (
            <MobileRecordCard key={contact.id} recordId={contact.id} labelledBy={`customer-contact-${contact.id}`}>
              <MobileRecordHeader className="flex-wrap">
                <div className="min-w-0"><h3 id={`customer-contact-${contact.id}`} className="font-semibold [overflow-wrap:anywhere]">{getContactDisplayName(contact)}</h3>{contact.role ? <p className="text-sm [overflow-wrap:anywhere]">{contact.role}</p> : null}</div>
                <div className="flex flex-wrap gap-1">
                  {contact.id === `${customer.id}-primary-contact` ? <Badge variant="secondary">Account</Badge> : null}{customer.billingContactId === contact.id ? <Badge>Billing</Badge> : null}
                  {sites.some((site) => site.contactId === contact.id) ? <Badge variant="secondary">Site contact</Badge> : null}
                </div>
              </MobileRecordHeader>
              <MobileRecordBody><p>Phone: {contact.phone || "Not set"}</p><p>Email: {contact.email || "Not set"}</p>{contact.notes ? <p className="whitespace-pre-wrap">{contact.notes}</p> : null}</MobileRecordBody>
            </MobileRecordCard>
          ))}</MobileRecordList>
        )}
    </CustomerSection>
  );
}

function CustomerJobsSection({ jobs, onOpenJob, desktop }) {
  return (
    <CustomerSection desktop={desktop} name="jobs" title="Job History" count={jobs.length} description={jobs.length ? "Most recent activity first." : ""}>
        {jobs.length ? <CustomerJobHistory jobs={jobs} onOpenJob={onOpenJob} /> : <p className="text-sm text-text-secondary">No jobs recorded yet.</p>}
    </CustomerSection>
  );
}

export default function CustomerWorkspace({ customer, jobs, tab = "overview", onTabChange, backLabel, onBack, onEdit, onDelete, onOpenSite, onCreateSite, onOpenJob }) {
  const desktop = useMediaQuery("(min-width: 64rem)");
  const [deleting, setDeleting] = useState(false);
  const sites = buildCustomerSites(customer, jobs);
  const contacts = getCustomerContacts(customer);
  const tabValue = ["overview", "sites", "contacts", "jobs"].includes(tab) ? tab : "overview";
  const deleteCustomer = async () => {
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); }
  };
  const sections = {
    overview: <CustomerDetailsSection desktop={desktop} customer={customer} jobs={jobs} deleting={deleting} onDelete={deleteCustomer} />,
    sites: <CustomerSitesSection desktop={desktop} sites={sites} onOpenSite={onOpenSite} onCreateSite={onCreateSite} />,
    contacts: <CustomerContactsSection desktop={desktop} customer={customer} contacts={contacts} sites={sites} />,
    jobs: <CustomerJobsSection desktop={desktop} jobs={jobs} onOpenJob={onOpenJob} />,
  };

  return (
    <RecordWorkspace backLabel={backLabel} eyebrow="Customers" title={customer.name} subtitle={[customer.email, customer.phone].filter(Boolean).join(" · ")}
      status={<Badge className="bg-card/90 text-foreground">{formatCustomerType(customer.customerType)}</Badge>}
      onBack={() => onBack()} maxWidth={desktop ? "max-w-none" : RECORD_WORKSPACE_WIDE_MAX_WIDTH} headerActions={<Button type="button" className="h-11" onClick={onEdit}>Edit Customer</Button>}>
      <div className="min-w-0 text-sm [&_[data-mobile-record-card]]:rounded-lg [&_[data-mobile-record-card]]:p-2.5" data-customer-workspace>
        {desktop ? (
          <>
          <div className="customer-workspace-grid grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-3">
            <div className="grid min-w-0 gap-3" data-customer-column="left">{sections.overview}{sections.contacts}</div>
            <div className="grid min-w-0 gap-3" data-customer-column="right">{sections.sites}{sections.jobs}</div>
          </div>
          <section className="mt-3 flex min-w-0 items-center justify-between gap-3 border-y border-border py-2" aria-label="Destructive customer actions" data-customer-danger-zone>
            <span className="text-xs font-medium text-text-secondary">Danger zone</span>
            <Button type="button" variant="outline" className="border-status-danger-border text-status-danger hover:bg-status-danger-surface" disabled={deleting} onClick={deleteCustomer}>Delete Customer</Button>
          </section>
          </>
        ) : (
          <Tabs value={tabValue} onValueChange={onTabChange} className="min-w-0 gap-3">
            <div className="record-tab-strip min-w-0 overflow-x-auto pb-1">
              <TabsList className="record-workspace-tabs h-auto min-h-11 w-max justify-start gap-1 bg-transparent" aria-label="Customer sections">
                {[['overview', 'Overview', null], ['sites', 'Sites', sites.length], ['contacts', 'Contacts', contacts.length], ['jobs', 'Job History', jobs.length]].map(([value, label, count]) => (
                  <TabsTrigger key={value} value={value} className="min-h-11 flex-none px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{label}{count !== null ? <span className="text-xs opacity-75">{count}</span> : null}</TabsTrigger>
                ))}
              </TabsList>
            </div>
            {Object.entries(sections).map(([value, content]) => <TabsContent key={value} value={value} className="min-w-0">{content}</TabsContent>)}
          </Tabs>
        )}
      </div>
    </RecordWorkspace>
  );
}
