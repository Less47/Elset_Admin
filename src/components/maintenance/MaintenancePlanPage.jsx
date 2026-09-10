import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RecordWorkspace, WorkspaceActionBar, WorkspaceMessage, WorkspaceSection } from "@/components/workspace/RecordWorkspace";
import { getMaintenanceFrequencyMeta, getMaintenancePlanStatus, maintenanceFrequencyOptions, normalizeChecklistItems, slugDate } from "@/lib/app-support";
import { effectiveMaintenancePlan, formatMaintenanceDate as formatDate } from "@/lib/maintenance-recurrence";
import { normalizeMaintenanceFrequency } from "@/lib/maintenance-frequency";
import { maintenanceCustomerSites, maintenancePlanName, maintenancePlanSite } from "@/lib/maintenance-plan";
import { MaintenanceMetrics } from "./MaintenanceManager";
import MaintenanceDateChoice from "./MaintenanceDateChoice";
import MaintenanceRecordPicker from "./MaintenanceRecordPicker";
import "./Maintenance.css";

function draftFor(plan, customers) {
  const site = plan ? maintenancePlanSite(plan, customers) : null;
  return { customerId: plan?.customerId || "", siteId: site?.id || plan?.siteId || "", siteAddress: site?.address || plan?.siteAddress || "", assetId: plan?.assetId || "",
    frequency: normalizeMaintenanceFrequency(plan?.frequency), nextDueDate: plan?.nextDueDate || slugDate(),
    estimatedDurationHours: String(plan?.estimatedDurationHours ?? 1), contractPrice: (plan?.contractPriceSet ?? plan?.contractPrice > 0) ? String(plan.contractPrice) : "",
    checklistText: (plan?.checklist || []).join("\n"), notes: plan?.notes || "", active: plan?.active !== false,
    defaultTechnicianId: plan?.defaultTechnicianId || "" };
}

function MaintenanceEditor({ plan, data, navigation, actions, backLabel }) {
  const [original] = useState(() => plan);
  const [initial] = useState(() => draftFor(plan, data.customers));
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState(false);
  const saving = useRef(false);
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  const registerBlocker = navigation.registerBlocker;
  useEffect(() => registerBlocker(() => dirty || saving.current), [registerBlocker, dirty]);
  useEffect(() => {
    if (!dirty) return undefined;
    const prevent = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const changedFrequency = Boolean(original && draft.frequency !== normalizeMaintenanceFrequency(original.frequency));
  const changedDate = Boolean(original && draft.nextDueDate !== original.nextDueDate);
  const customer = data.customers.find((entry) => entry.id === draft.customerId);
  const sites = maintenanceCustomerSites(customer);
  const site = sites.find((entry) => entry.id === draft.siteId);
  const legacySite = Boolean(original && !initial.siteId && draft.customerId === initial.customerId && !draft.siteId && draft.siteAddress === initial.siteAddress && draft.siteAddress);
  const planName = maintenancePlanName(site || (legacySite ? { address: draft.siteAddress } : null));
  const canSave = Boolean(customer && (site || legacySite) && planName);
  const customerItems = useMemo(() => data.customers.map((entry) => ({ id: entry.id, label: entry.name, description: entry.address || entry.sites?.[0]?.address || entry.email,
    searchText: [entry.name, entry.email, entry.phone, ...(entry.contacts || []).flatMap((contact) => [contact.name, contact.email, contact.phone]), ...(entry.sites || []).flatMap((record) => [record.label, record.address, record.contactName, record.contactPhone, record.contactEmail])].filter(Boolean).join(" ") })), [data.customers]);
  const siteItems = sites.map((entry) => ({ id: entry.id, label: entry.address, description: entry.label || "", searchText: [entry.address, entry.label, entry.streetAddress, entry.addressLine1, entry.suburb, entry.locality, entry.city].filter(Boolean).join(" ") }));
  const selectCustomer = (customerId) => {
    const nextSites = maintenanceCustomerSites(data.customers.find((entry) => entry.id === customerId));
    const nextSite = nextSites.length === 1 ? nextSites[0] : null;
    setDraft((previous) => ({ ...previous, customerId, siteId: nextSite?.id || "", siteAddress: nextSite?.address || "", assetId: "" }));
  };
  const selectSite = (siteId) => setDraft((previous) => ({ ...previous, siteId, siteAddress: sites.find((entry) => entry.id === siteId)?.address || "", assetId: "" }));
  const field = (key) => ({ value: draft[key], onChange: (event) => setDraft((previous) => ({ ...previous, [key]: event.target.value })) });

  async function save(scope) {
    if (saving.current) return;
    if (!canSave) { setError("Select a customer and a valid site before saving the plan."); return; }
    if ((changedDate || changedFrequency) && !scope) { setChoice(true); return; }
    saving.current = true; setBusy(true); setError("");
    try {
      const input = { ...draft, planName, siteAddress: site?.address || draft.siteAddress, estimatedDurationHours: Number(draft.estimatedDurationHours || 0), contractPrice: Number(draft.contractPrice || 0),
        contractPriceSet: draft.contractPrice.trim() !== "", checklist: normalizeChecklistItems(draft.checklistText),
        revision: original?.maintenanceRevision || 0,
        ...(scope ? { dateChange: { scope, occurrenceKey: original.nextOccurrence?.key } } : {}),
      };
      delete input.checklistText;
      const saved = original ? await actions.handleUpdateMaintenancePlan(original.id, input) : await actions.handleCreateMaintenancePlan(input);
      if (!saved) return;
      navigation.navigateToMaintenance(saved.id || original?.id, { replace: true, force: true });
    } catch (failure) { setError(failure.message || "Unable to save this maintenance plan."); }
    finally { saving.current = false; setBusy(false); setChoice(false); }
  }
  return <RecordWorkspace title={original ? "Edit Maintenance Plan" : "Add Maintenance Plan"} eyebrow="Maintenance" backLabel={backLabel} onBack={() => navigation.closeWorkspace()}>
    <form data-maintenance-editor onSubmit={(event) => { event.preventDefault(); save(); }}>
      {error ? <div className="mb-4" role="alert"><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
      <fieldset disabled={busy} className="maintenance-detail-grid">
        <WorkspaceSection panel title="Plan Details"><div className="grid gap-4">
          <MaintenanceRecordPicker label="Customer" placeholder="Search customers..." items={customerItems} value={draft.customerId} onSelect={selectCustomer} required disabled={busy} />
          {customer && sites.length ? <MaintenanceRecordPicker key={customer.id} label="Site" placeholder="Search/select site..." items={siteItems} value={draft.siteId} onSelect={selectSite} required={!legacySite} disabled={busy} /> : customer ? <div className="maintenance-site-empty"><p>No sites found for this customer.</p><Button type="button" size="sm" variant="outline" onClick={() => actions.handleCreateSiteProfile(customer.id)}>Add Site</Button></div> : <p className="text-xs text-muted-foreground">Select a customer to choose their site.</p>}
          {legacySite ? <p className="text-xs text-text-secondary">Legacy site address: {draft.siteAddress}. {sites.length ? "Choose a saved site to link this plan." : "This existing address is retained until you select a saved site."}</p> : null}
          {planName ? <dl className="maintenance-plan-preview" aria-live="polite"><dt>Plan</dt><dd>{planName}</dd></dl> : null}
          <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Frequency<select className="h-11 rounded-lg border bg-card px-3" {...field("frequency")}>{maintenanceFrequencyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="grid gap-1.5 text-sm font-medium">Next due date<Input type="date" {...field("nextDueDate")} required /></label></div>
          <label className="grid gap-1.5 text-sm font-medium">Status<select className="h-11 rounded-lg border bg-card px-3" value={draft.active ? "active" : "inactive"} onChange={(event) => setDraft((previous) => ({ ...previous, active: event.target.value === "active" }))}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
          <p className="text-xs text-muted-foreground">Active plans appear automatically on the Calendar.</p>
        </div></WorkspaceSection>
        <div className="maintenance-detail-column"><WorkspaceSection panel title="Visit Defaults"><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Estimated hours<Input type="number" min="0" step="0.5" {...field("estimatedDurationHours")} /></label><label className="grid gap-1.5 text-sm font-medium">Contract price<Input type="number" min="0" step="0.01" placeholder="Not set" {...field("contractPrice")} /></label></div></WorkspaceSection>
          <WorkspaceSection panel title="Checklist"><label className="grid gap-1.5 text-xs text-text-secondary">One item per line<Textarea rows={6} {...field("checklistText")} /></label></WorkspaceSection>
          <WorkspaceSection panel title="Notes"><Textarea aria-label="Plan notes" rows={3} {...field("notes")} /></WorkspaceSection>
        </div>
      </fieldset>
      <WorkspaceActionBar status={busy ? "Saving…" : dirty ? "Unsaved changes" : ""}><Button type="button" variant="outline" disabled={busy} onClick={() => navigation.closeWorkspace()}>Cancel</Button><Button type="submit" disabled={busy || !canSave}>{original ? "Save Plan" : "Create Plan"}</Button></WorkspaceActionBar>
    </form>
    <MaintenanceDateChoice open={choice} from={original?.nextDueDate} to={draft.nextDueDate} frequencyChanged={changedFrequency} busy={busy} onChoose={save} onCancel={() => setChoice(false)} />
  </RecordWorkspace>;
}

export default function MaintenancePlanPage({ route, navigation, actions, data, backLabel }) {
  const source = data.maintenancePlans.find((entry) => entry.id === route.planId);
  const plan = source ? effectiveMaintenancePlan(source, data.jobs) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  if (route.type === "create-maintenance" || (plan && route.type === "edit-maintenance")) return <MaintenanceEditor plan={plan} data={data} navigation={navigation} actions={actions} backLabel={backLabel} />;
  if (!plan) return <RecordWorkspace title="Maintenance Plan" backLabel={backLabel} onBack={() => navigation.closeWorkspace()}><WorkspaceMessage>This maintenance plan was not found.</WorkspaceMessage></RecordWorkspace>;
  const customer = data.customers.find((entry) => entry.id === plan.customerId);
  const jobs = data.jobs.filter((job) => job.maintenancePlanId === plan.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const status = getMaintenancePlanStatus(plan, data.jobs);
  const activity = [
    ...jobs.map((job) => ({ key: `generated-${job.id}`, date: job.createdAt, text: `Generated Job #${job.jobNumber}` })),
    ...(plan.occurrenceExceptions || []).filter((entry) => entry.completedAt).map((entry) => ({ key: `completed-${entry.key}`, date: entry.completedAt, text: `Completed maintenance for ${formatDate(entry.overrideDate || entry.snapshot?.date || entry.originalDate)}` })),
    ...(plan.occurrenceExceptions || []).filter((entry) => entry.overrideDate).map((entry) => ({ key: `moved-${entry.key}`, date: entry.updatedAt, text: `Moved visit: ${formatDate(entry.originalDate)} → ${formatDate(entry.overrideDate)}` })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  async function generate() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try { await actions.handleGenerateMaintenanceJob(plan.id, plan.nextOccurrence); }
    catch (failure) { setError(failure.message); }
    finally { saving.current = false; setBusy(false); }
  }
  return <RecordWorkspace title={plan.planName} eyebrow="Maintenance Plan" subtitle={`${customer?.name || "Unknown customer"} · ${plan.siteAddress}`} backLabel={backLabel} onBack={() => navigation.closeWorkspace()} status={<Badge className={status.className}>{status.label}</Badge>} headerActions={<Button variant="outline" size="sm" onClick={() => navigation.navigateToMaintenance(plan.id, { edit: true })}>Edit Plan</Button>}>
    {error ? <div role="alert" className="mb-4"><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
    <div className="maintenance-detail-grid" data-maintenance-detail>
      <div className="maintenance-detail-column"><WorkspaceSection panel title="Plan Details" trailing={<Button size="sm" disabled={busy || !plan.active} onClick={generate}>{busy ? "Generating…" : "Generate Job"}</Button>}><dl className="grid gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Customer</dt><dd className="font-medium">{customer?.name || "Unknown customer"}</dd></div><div><dt className="text-xs text-muted-foreground">Site</dt><dd>{plan.siteAddress}</dd></div><div className="flex gap-6"><div><dt className="text-xs text-muted-foreground">Frequency</dt><dd>{getMaintenanceFrequencyMeta(plan.frequency).label}</dd></div><div><dt className="text-xs text-muted-foreground">Status</dt><dd>{plan.active ? "Active" : "Inactive"}</dd></div></div></dl><MaintenanceMetrics plan={plan} />{plan.notes ? <p className="mt-4 whitespace-pre-wrap text-sm text-text-secondary">{plan.notes}</p> : null}</WorkspaceSection>
        <WorkspaceSection panel title="Recent Activity"><div className="grid gap-2 text-xs text-text-secondary"><p>Last generated: <strong>{plan.lastGeneratedAt ? formatDate(plan.lastGeneratedAt) : "Not yet"}</strong></p><p>Last completed: <strong>{plan.lastCompletedAt ? formatDate(plan.lastCompletedAt) : "Not yet"}</strong></p></div>{activity.length ? <ol className="mt-4 grid gap-3">{activity.map((entry) => <li key={entry.key} className="border-l-2 border-border pl-3 text-sm"><p>{entry.text}</p><time className="text-xs text-muted-foreground">{formatDate(entry.date)}</time></li>)}</ol> : <p className="mt-3 text-sm text-muted-foreground">No activity yet.</p>}</WorkspaceSection>
      </div>
      <div className="maintenance-detail-column"><WorkspaceSection panel title="Checklist">{plan.checklist.length ? <ol className="grid list-decimal gap-2 pl-5 text-sm text-text-secondary">{plan.checklist.map((item, index) => <li key={index}>{typeof item === "string" ? item : item.text}</li>)}</ol> : <p className="text-sm text-muted-foreground">No checklist saved yet.</p>}</WorkspaceSection>
        <WorkspaceSection panel title="Generated Jobs">{jobs.length ? <div className="grid gap-3">{jobs.map((job) => <article className="rounded-lg border border-border p-3" key={job.id}><div className="flex items-center justify-between gap-2"><strong className="text-sm">Job #{job.jobNumber}</strong><Badge variant="secondary">{job.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Scheduled: {job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => actions.handleOpenJob(job)}>Open Job</Button></article>)}</div> : <p className="text-sm text-muted-foreground">No jobs generated. Recurring visits are already on the Calendar.</p>}</WorkspaceSection>
        <details className="rounded-xl border border-status-danger-border bg-card p-4"><summary className="cursor-pointer text-xs font-semibold text-status-danger">Delete maintenance plan</summary><p className="my-3 text-xs text-text-secondary">Stop this recurring plan and move it to the archive. Generated jobs are retained.</p><Button variant="destructive" size="sm" onClick={async () => { if (await actions.handleDeleteMaintenancePlan(plan.id)) navigation.navigateToSection("maintenance"); }}>Delete Plan</Button></details>
      </div>
    </div>
  </RecordWorkspace>;
}
