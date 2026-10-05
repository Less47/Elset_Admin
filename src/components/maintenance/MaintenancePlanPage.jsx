import { useLocation, useMatches, useNavigate, useOutletContext, useParams } from "react-router";
import { recordLinkState } from "@/lib/record-link-state";
import { useUnsavedChanges } from "@/components/workspace/unsaved-changes-context";
import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RecordWorkspace, WorkspaceActionBar, WorkspaceMessage, WorkspaceSection } from "@/components/workspace/RecordWorkspace";
import { getMaintenanceFrequencyMeta, getMaintenancePlanStatus, maintenanceFrequencyOptions, slugDate } from "@/lib/app-support";
import { effectiveMaintenancePlan, formatMaintenanceDate as formatDate } from "@/lib/maintenance-recurrence";
import { normalizeMaintenanceFrequency } from "@/lib/maintenance-frequency";
import { maintenanceCustomerSites, maintenancePlanName, maintenancePlanSite } from "@/lib/maintenance-plan";
import MaintenanceDateChoice from "./MaintenanceDateChoice";
import MaintenanceRecordPicker from "./MaintenanceRecordPicker";
import MaintenanceChecklistEditor from "./MaintenanceChecklistEditor";
import MaintenanceServiceHistory from "./MaintenanceServiceHistory";
import { maintenanceChecklistItems, starterMaintenanceChecklist } from "@/lib/maintenance-checklist";
import "./MaintenanceService.css";
import "./Maintenance.css";

function draftFor(plan, customers) {
  const site = plan ? maintenancePlanSite(plan, customers) : null;
  return { customerId: plan?.customerId || "", siteId: site?.id || plan?.siteId || "", siteAddress: site?.address || plan?.siteAddress || "", assetId: plan?.assetId || "",
    frequency: normalizeMaintenanceFrequency(plan?.frequency), nextDueDate: plan?.nextDueDate || slugDate(),
    estimatedDurationHours: String(plan?.estimatedDurationHours ?? 1), contractPrice: (plan?.contractPriceSet ?? plan?.contractPrice > 0) ? String(plan.contractPrice) : "",
    notes: plan?.notes || "", active: plan?.active !== false,
    checklistItems: plan ? maintenanceChecklistItems(plan.checklistItems || plan.checklist, plan.id) : starterMaintenanceChecklist(crypto.randomUUID()),
    defaultTechnicianId: plan?.defaultTechnicianId || "" };
}

function MaintenanceEditor({ plan, data, actions, backLabel, onBack, checklistEnabled }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [original] = useState(() => plan);
  const [initial] = useState(() => draftFor(plan, data.customers));
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState(false);
  const saving = useRef(false);
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  const markSaved = useUnsavedChanges(dirty, { busy });
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
        contractPriceSet: draft.contractPrice.trim() !== "",
        revision: original?.maintenanceRevision || 0,
        ...(scope ? { dateChange: { scope, occurrenceKey: original.nextOccurrence?.key } } : {}),
      };
      if (original || !checklistEnabled) delete input.checklistItems;
      const saved = original ? await actions.handleUpdateMaintenancePlan(original.id, input) : await actions.handleCreateMaintenancePlan(input);
      if (!saved) return;
      markSaved();
      navigate(`/maintenance/${encodeURIComponent(saved.id || original?.id)}`, { replace: true, state: location.state });
    } catch (failure) { setError(failure.message || "Unable to save this maintenance plan."); }
    finally { saving.current = false; setBusy(false); setChoice(false); }
  }
  async function remove() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      if (await actions.handleDeleteMaintenancePlan(original.id)) { markSaved(); navigate("/maintenance"); }
    } catch (failure) { setError(failure.message || "Unable to delete this maintenance plan."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <RecordWorkspace title={original ? "Edit Maintenance Plan" : "Add Maintenance Plan"} eyebrow="Maintenance" backLabel={backLabel} onBack={() => onBack()}>
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
          <label className="grid gap-1.5 text-sm font-medium">Default technician<select className="h-11 rounded-lg border bg-card px-3" {...field("defaultTechnicianId")}><option value="">Unassigned</option>{data.staff.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></label>
          {!original && checklistEnabled ? <WorkspaceSection panel title="Checklist"><p className="mb-3 text-xs text-muted-foreground">Ten starter items. Edit, remove or reorder any item.</p><MaintenanceChecklistEditor items={draft.checklistItems} onChange={checklistItems => setDraft(previous => ({ ...previous, checklistItems }))} /></WorkspaceSection> : null}
          <WorkspaceSection panel title="Notes"><Textarea aria-label="Plan notes" rows={3} {...field("notes")} /></WorkspaceSection>
        </div>
      </fieldset>
      <WorkspaceActionBar status={busy ? "Saving…" : dirty ? "Unsaved changes" : ""}><Button type="button" variant="outline" disabled={busy} onClick={() => onBack()}>Cancel</Button><Button type="submit" disabled={busy || !canSave}>{original ? "Save Plan" : "Create Plan"}</Button></WorkspaceActionBar>
    </form>
    {original ? <details className="mb-20 mt-4 border-t pt-3 lg:mb-0"><summary className="cursor-pointer text-xs font-semibold text-status-danger">Delete maintenance plan</summary><p className="my-3 text-xs text-text-secondary">Stop this recurring plan and move it to the archive. Generated jobs are retained.</p><Button type="button" className="h-11" variant="destructive" size="sm" disabled={busy} onClick={remove}>Delete Plan</Button></details> : null}
    <MaintenanceDateChoice open={choice} from={original?.nextDueDate} to={draft.nextDueDate} frequencyChanged={changedFrequency} busy={busy} onChoose={save} onCancel={() => setChoice(false)} />
  </RecordWorkspace>;
}

function PlanChecklist({ plan, enabled, actions }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState([]), [initial, setInitial] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef(false);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(initial?.items);
  const markSaved = useUnsavedChanges(dirty, { busy });
  const items = maintenanceChecklistItems(plan.checklistItems || plan.checklist, plan.id);
  async function save(event) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const saved = await actions.handleUpdateMaintenancePlan(plan.id, { checklistItems: draft, revision: initial.revision });
      if (saved) { markSaved(); setEditing(false); }
    } catch (failure) { setError(failure.message || "Unable to save the checklist."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section data-plan-checklist className="min-w-0">
    <div className="maintenance-column-heading"><h2 className="text-base font-semibold sm:text-lg">Checklist</h2>
      {enabled && !editing ? <Button className="h-11" type="button" size="sm" variant="outline" onClick={() => { setInitial({ items, revision: plan.maintenanceRevision }); setDraft(items); setEditing(true); setError(""); }}>Edit Checklist</Button> : null}
    </div>
    {error ? <div role="alert" className="mb-3"><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
    {enabled && editing ? <form onSubmit={save} data-plan-checklist-editor><fieldset disabled={busy}>
      <MaintenanceChecklistEditor items={draft} onChange={setDraft} />
      <div className="mt-4 flex flex-wrap items-center gap-2"><Button className="h-11" variant="outline" type="button" onClick={() => { markSaved(); setEditing(false); setError(""); }}>Cancel</Button><Button className="h-11" type="submit">{busy ? "Saving…" : "Save Checklist"}</Button></div>
      {dirty ? <p className="mt-2 text-xs text-muted-foreground">Unsaved checklist changes</p> : null}
    </fieldset></form> : items.length ? <table className="maintenance-checklist-table maintenance-plan-checklist" aria-label="Plan checklist"><thead><tr><th scope="col">No.</th><th scope="col">Checklist item</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td className="maintenance-number-cell">{item.position}</td><td>{item.text}</td></tr>)}</tbody></table> : <p className="text-sm text-muted-foreground">No checklist saved yet.</p>}
  </section>;
}

export default function MaintenancePlanPage() {
  const { workspaceActions: actions, data, session, workspaceAddons } = useOutletContext();
  const checklistEnabled = workspaceAddons.addons.maintenanceChecklists === true;
  const { planId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const match = useMatches().at(-1);
  const mode = match.id;
  const parentPath = mode === "edit-maintenance" ? `/maintenance/${encodeURIComponent(planId)}` : "/maintenance";
  const backLabel = location.state?.returnTo?.label || "Maintenance";
  const onBack = () => navigate(location.state?.returnTo ? -1 : parentPath, { replace: !location.state?.returnTo });
  const linkState = recordLinkState(location, match, data.jobs);
  const source = data.maintenancePlans.find((entry) => entry.id === planId);
  const plan = source ? effectiveMaintenancePlan(source, data.jobs) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  if (!session.canManageBusiness) return <RecordWorkspace title="Maintenance" backLabel={backLabel} onBack={onBack}><WorkspaceMessage tone="error">You do not have permission to view maintenance plans.</WorkspaceMessage></RecordWorkspace>;
  if (mode === "create-maintenance" || (plan && mode === "edit-maintenance")) return <MaintenanceEditor key={location.pathname} plan={plan} data={data} onBack={onBack} actions={actions} backLabel={backLabel} checklistEnabled={checklistEnabled} />;
  if (!plan) return <RecordWorkspace title="Maintenance Plan" backLabel={backLabel} onBack={() => onBack()}><WorkspaceMessage>This maintenance plan was not found.</WorkspaceMessage></RecordWorkspace>;
  const customer = data.customers.find((entry) => entry.id === plan.customerId);
  const jobs = data.jobs.filter((job) => job.maintenancePlanId === plan.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const status = getMaintenancePlanStatus(plan, data.jobs);
  const activity = [
    ...jobs.map((job) => ({ key: `generated-${job.id}`, date: job.createdAt, text: `Generated Job #${job.jobNumber}` })),
    ...(plan.occurrenceExceptions || []).filter((entry) => entry.completedAt).map((entry) => ({ key: `completed-${entry.key}`, date: entry.completedAt, text: `Completed maintenance for ${formatDate(entry.snapshot?.scheduleCorrectionBaseline?.date || entry.overrideDate || entry.snapshot?.date || entry.originalDate)}` })),
    ...(plan.occurrenceExceptions || []).map((entry) => ({ ...entry, ...(entry.snapshot?.occurrenceMoveBaseline || entry.snapshot?.scheduleCorrectionBaseline || {}) })).filter((entry) => entry.overrideDate).map((entry) => ({ key: `moved-${entry.key}`, date: entry.updatedAt, text: `Moved visit: ${formatDate(entry.originalDate)} → ${formatDate(entry.overrideDate)}` })),
    ...(plan.occurrenceExceptions || []).flatMap((entry) => (entry.snapshot?.occurrenceMoves || []).map((move, index) => ({ key: `move-${entry.key}-${index}`, date: move.changedAt, text: `Moved visit: ${formatDate(move.from)} → ${formatDate(move.to)}` }))),
    ...(plan.occurrenceExceptions || []).flatMap((entry) => (entry.snapshot?.scheduleCorrections || []).map((correction, index) => ({ key: `corrected-${entry.key}-${index}`, date: correction.changedAt, text: `Job #${correction.jobNumber}: Schedule corrected from ${formatDate(correction.from)} to ${formatDate(correction.to)}.` }))),
  ].sort((a, b) => b.date.localeCompare(a.date));
  async function generate() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try { await actions.handleGenerateMaintenanceJob(plan.id, plan.nextOccurrence); }
    catch (failure) { setError(failure.message); }
    finally { saving.current = false; setBusy(false); }
  }
  const defaultTechnician = data.staff.find(staff => staff.id === plan.defaultTechnicianId)?.name || "Unassigned";
  return <RecordWorkspace maxWidth="max-w-none" title={plan.planName} eyebrow="Maintenance Plan" subtitle={`${customer?.name || "Unknown customer"} · ${plan.siteAddress}`} backLabel={backLabel} onBack={onBack} status={<Badge className={status.className}>{status.label}</Badge>} headerActions={<Button variant="outline" size="sm" onClick={() => navigate(`/maintenance/${encodeURIComponent(plan.id)}/edit`, { state: linkState })}>Edit Plan</Button>}>
    {error ? <div role="alert" className="mb-4"><WorkspaceMessage tone="error">{error}</WorkspaceMessage></div> : null}
    <div className="maintenance-plan-workspace" data-maintenance-detail>
      <section className="maintenance-plan-details" data-plan-details>
        <div className="maintenance-column-heading"><h2 className="text-base font-semibold sm:text-lg">Plan Details</h2><Button className="h-11" size="sm" disabled={busy || !plan.active} onClick={generate}>{busy ? "Generating…" : "Generate Job"}</Button></div>
        <dl className="maintenance-plan-fields text-sm">
          <div><dt>Customer</dt><dd>{customer?.name || "Unknown customer"}</dd></div>
          <div><dt>Site</dt><dd>{plan.siteAddress}</dd></div>
          <div><dt>Frequency</dt><dd>{getMaintenanceFrequencyMeta(plan.frequency).label}</dd></div>
          <div><dt>Next due date</dt><dd>{formatDate(plan.nextDueDate)}</dd></div>
          <div><dt>Default technician</dt><dd>{defaultTechnician}</dd></div>
          <div><dt>Estimated duration</dt><dd>{plan.estimatedDurationHours || 0} hours</dd></div>
          <div><dt>Contract price</dt><dd data-contract-price={(plan.contractPriceSet ?? plan.contractPrice > 0) ? "set" : "missing"}>{(plan.contractPriceSet ?? plan.contractPrice > 0) ? new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(plan.contractPrice) : "Not set"}</dd></div>
          <div><dt>Status</dt><dd>{plan.active ? "Active" : "Inactive"}</dd></div>
          <div><dt>Last generated</dt><dd>{plan.lastGeneratedAt ? formatDate(plan.lastGeneratedAt) : "Not yet"}</dd></div>
          <div><dt>Last completed</dt><dd>{plan.lastCompletedAt ? formatDate(plan.lastCompletedAt) : "Not yet"}</dd></div>
          {plan.assetId ? <div><dt>Asset</dt><dd>{plan.assetId}</dd></div> : null}
          <div className="maintenance-plan-notes"><dt>Notes</dt><dd className="whitespace-pre-wrap">{plan.notes || "No plan notes."}</dd></div>
        </dl>
      </section>
      <section className="maintenance-plan-jobs" data-plan-jobs><h2 className="mb-3 text-base font-semibold sm:text-lg">Generated Jobs</h2>
        {jobs.length ? <ol>{jobs.map(job => {
          const completedAt = plan.occurrenceExceptions?.find(entry => entry.jobId === job.id)?.completedAt;
          return <li key={job.id}><button type="button" className="maintenance-generated-job" aria-label={`Open Job #${job.jobNumber}`} onClick={() => actions.handleOpenJob(job)}>
            <span className="flex flex-wrap items-center justify-between gap-1"><strong>Job #{job.jobNumber}</strong><span className="text-xs text-text-secondary">{job.status}</span></span>
            <span className="text-xs text-muted-foreground">Scheduled: {job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"}{completedAt ? ` · Completed: ${formatDate(completedAt)}` : ""}</span>
            {job.assignedTechnicianName ? <span className="text-xs text-muted-foreground">{job.assignedTechnicianName}</span> : null}
          </button></li>;
        })}</ol> : <p className="text-sm text-muted-foreground">No jobs generated. Recurring visits are already on the Calendar.</p>}
        <section className="mt-5 border-t pt-3"><h3 className="text-xs font-semibold">Recent Activity</h3>{activity.length ? <ol className="mt-3 grid gap-2 text-xs text-text-secondary">{activity.map(entry => <li key={entry.key}><p>{entry.text}</p><time className="text-muted-foreground">{formatDate(entry.date)}</time></li>)}</ol> : <p className="mt-2 text-xs text-muted-foreground">No activity yet.</p>}</section>
      </section>
      <div className="maintenance-plan-history"><MaintenanceServiceHistory planId={plan.id} enabled={checklistEnabled} fetchWithAuth={session.fetchWithAuth} /></div>
      <div className="maintenance-plan-template"><PlanChecklist key={plan.id} plan={plan} enabled={checklistEnabled} actions={actions} /></div>
    </div>
  </RecordWorkspace>;
}
