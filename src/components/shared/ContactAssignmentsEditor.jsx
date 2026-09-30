import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FormField } from "./FormField";
import { contactRoles } from "@/lib/contact-model";

const suggestedRoles = ["Accounts", "Property Manager", "Building Manager", "Caretaker", "Tenant / Occupant", "Operations", "Other"];

export function ContactList({ contacts, customer = false }) {
  return <div className="min-w-0 divide-y" aria-label={customer ? "Customer contacts" : "Site contacts"}>
    {!contacts.length ? <p className="py-3 text-sm text-text-secondary">No contacts assigned.</p> : contacts.map((contact) => <div key={contact.id} className="min-w-0 py-2.5 text-sm [overflow-wrap:anywhere]" data-contact-id={contact.id}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5"><span className="font-semibold">{contact.name || contact.email || contact.phone || "Unnamed contact"}</span>
        {contact.isPrimary ? <Badge>Primary</Badge> : null}{contact.isBilling ? <Badge>Billing</Badge> : null}
        {customer ? <Badge variant="secondary">{contact.isDirect ? "Customer contact" : "Site-only contact"}</Badge> : null}
        {(contact.roles || []).map((role) => <Badge key={role} variant="outline" className="h-auto max-w-full whitespace-normal">{role}</Badge>)}
      </div>
      {contact.position ? <p className="text-xs text-text-secondary">{contact.position}</p> : null}
      <div className="mt-1 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs"><span>{contact.phone || "No phone"}</span><span>{contact.email || "No email"}</span></div>
      {contact.sites?.length ? <div className="mt-1.5 flex min-w-0 flex-wrap gap-1" aria-label="Assigned sites">{contact.sites.map((site) => <Badge key={site.siteId} variant="secondary" className="h-auto max-w-full whitespace-normal">{site.name}{site.isPrimary ? " · Primary" : ""}{site.roles.length ? ` · ${site.roles.join(", ")}` : ""}</Badge>)}</div> : null}
      {contact.notes ? <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">{contact.notes}</p> : null}
    </div>)}
  </div>;
}

// Draft changes are submitted with the owner record in one transaction. Only edited
// identities include `contact`; hydrated display copies never overwrite people.
export default function ContactAssignmentsEditor({ value = [], onChange, contacts = [], preferredContacts = [], kind = "customer" }) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState("existing");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState("");
  const byId = new Map([...contacts, ...preferredContacts].map((contact) => [contact.id, contact]));
  const preferred = new Set(preferredContacts.map((contact) => contact.id));
  const candidates = [...byId.values()].filter((contact) => !value.some((assignment) => assignment.contactId === contact.id)
    && [contact.name, contact.position, contact.email, contact.phone].join(" ").toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)) || (a.name || a.email || a.id).localeCompare(b.name || b.email || b.id));
  const update = (contactId, patch) => onChange(value.map((assignment) => assignment.contactId === contactId ? { ...assignment, ...patch }
    : patch.isPrimary ? { ...assignment, isPrimary: false } : assignment));
  const add = (contact, isNew = false) => {
    onChange([...value, { contactId: contact.id, roles: [], isPrimary: false, ...(kind === "customer" ? { isBilling: false } : {}), ...(isNew ? { contact } : {}) }]);
    setExpanded(contact.id); setAdding(false); setQuery("");
  };
  return <div className="grid min-w-0 gap-3 [&_button]:scroll-mb-28 [&_button]:scroll-mt-24" aria-label={`${kind === "customer" ? "Customer" : "Site"} contact management`}>
    <p className="text-xs text-text-secondary">{kind === "customer" ? "Remove from customer keeps this person available at their assigned sites. Account email and phone remain the billing fallback." : "Remove from site keeps this person available to other customers and sites."}</p>
    <div className="min-w-0 divide-y">{value.map((assignment) => {
      const contact = assignment.contact || byId.get(assignment.contactId) || { id: assignment.contactId };
      const open = expanded === assignment.contactId;
      const fieldPrefix = `${id}-${assignment.contactId}`;
      return <section key={assignment.contactId} className="min-w-0 py-3" aria-label={contact.name || "New contact"}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1 basis-full [overflow-wrap:anywhere] sm:basis-auto"><p className="font-medium">{contact.name || contact.email || "New contact"}</p><p className="text-xs text-text-secondary">{[contact.position, contact.phone, contact.email].filter(Boolean).join(" · ")}</p></div>
          <Button type="button" variant="ghost" aria-expanded={open} onClick={() => setExpanded(open ? "" : assignment.contactId)}>{open ? "Close details" : "Edit details"}</Button>
          <Button type="button" variant="outline" onClick={() => onChange(value.filter((entry) => entry.contactId !== assignment.contactId))}>Remove from {kind}</Button>
        </div>
        {open ? <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
          <p className="text-xs text-text-secondary sm:col-span-2">Changes to this person's details appear everywhere they are assigned. Saved job contacts stay unchanged.</p>
          {[["name", "Name"], ["position", "Position"], ["phone", "Phone"], ["email", "Email"]].map(([key, label]) => <FormField key={key} label={label} htmlFor={`${fieldPrefix}-${key}`}><Input id={`${fieldPrefix}-${key}`} value={contact[key] || ""} onChange={(event) => update(assignment.contactId, { contact: { ...contact, [key]: event.target.value } })} /></FormField>)}
          <div className="min-w-0 sm:col-span-2"><FormField label="Notes" htmlFor={`${fieldPrefix}-notes`}><Textarea id={`${fieldPrefix}-notes`} rows={2} value={contact.notes || ""} onChange={(event) => update(assignment.contactId, { contact: { ...contact, notes: event.target.value } })} /></FormField></div>
        </div> : null}
        <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <FormField label={`Roles at this ${kind}`} htmlFor={`${fieldPrefix}-roles`}><Input id={`${fieldPrefix}-roles`} placeholder="e.g. Property Manager, Caretaker" value={assignment.rolesText ?? contactRoles(assignment.roles).join(", ")} onChange={(event) => update(assignment.contactId, { rolesText: event.target.value, roles: contactRoles(event.target.value.split(",")) })} /></FormField>
            {open ? <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Suggested roles">{suggestedRoles.map((role) => {
              const selected = contactRoles(assignment.roles).includes(role);
              return <Button key={role} type="button" size="sm" variant={selected ? "secondary" : "outline"} aria-pressed={selected} onClick={() => {
                const roles = selected ? assignment.roles.filter((entry) => entry !== role) : [...contactRoles(assignment.roles), role];
                update(assignment.contactId, { roles, rolesText: roles.join(", ") });
              }}>{role}</Button>;
            })}</div> : null}
          </div>
          <div className="flex flex-wrap items-end gap-x-4">
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(assignment.isPrimary)} onChange={(event) => update(assignment.contactId, { isPrimary: event.target.checked })} />Primary contact</label>
            {kind === "customer" ? <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(assignment.isBilling)} onChange={(event) => update(assignment.contactId, { isBilling: event.target.checked })} />Billing contact</label> : null}
          </div>
        </div>
      </section>;
    })}</div>
    {adding ? <div className="min-w-0 rounded-lg border p-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Add contact method"><Button type="button" variant={mode === "existing" ? "default" : "outline"} onClick={() => setMode("existing")}>Existing contact</Button><Button type="button" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")}>New contact</Button><Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel adding</Button></div>
      {mode === "existing" ? <div className="mt-3 grid min-w-0 gap-2"><FormField label="Search contacts" htmlFor={`${id}-search`}><Input id={`${id}-search`} placeholder="Name, email, phone or position" value={query} onChange={(event) => setQuery(event.target.value)} /></FormField>
        <div className="max-h-64 min-w-0 overflow-y-auto" aria-label="Available contacts">{candidates.slice(0, 30).map((contact) => <button key={contact.id} type="button" className="block min-h-11 w-full min-w-0 border-b p-2 text-left text-sm hover:bg-muted [overflow-wrap:anywhere]" onClick={() => add(contact)}><span className="font-medium">{contact.name || contact.email || contact.phone}</span><span className="block text-xs text-text-secondary">{[contact.position, contact.email, contact.phone].filter(Boolean).join(" · ")}</span></button>)}{!candidates.length ? <p className="text-sm text-text-secondary">No matching contacts.</p> : null}</div>
      </div> : <div className="mt-3"><Button type="button" variant="outline" onClick={() => add({ id: crypto.randomUUID(), name: "", position: "", phone: "", email: "", notes: "" }, true)}>Create new contact</Button></div>}
    </div> : <Button type="button" variant="outline" className="justify-self-start" onClick={() => { setMode("existing"); setAdding(true); }}>Add Contact</Button>}
  </div>;
}
