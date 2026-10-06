import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FormField } from "./FormField";
import { contactRoles } from "@/lib/contact-model";

const suggestedRoles = ["Accounts", "Property Manager", "Building Manager", "Caretaker", "Tenant / Occupant", "Operations", "Other"];

function ExistingContactPicker({ contacts, onSelect }) {
  const id = useId();
  const list = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = contacts.filter((contact) => [contact.name, contact.position, contact.email, contact.phone].join(" ").toLowerCase().includes(query.toLowerCase().trim()));
  const visible = matches.slice(0, 30);
  const activeId = open && visible[active] ? `${id}-option-${active}` : undefined;
  useEffect(() => {
    if (activeId) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return <div className="relative mt-3 min-w-0" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <FormField label="Search contacts" htmlFor={id}>
      <Input id={id} role="combobox" autoComplete="off" placeholder="Name, email, phone or position" value={query}
        aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-activedescendant={activeId}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive((index) => !visible.length ? -1 : index < 0 ? (event.key === "ArrowDown" ? 0 : visible.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (open && visible[active]) onSelect(visible[active]);
            else setOpen(true);
          } else if (event.key === "Escape" && open) {
            event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1);
          }
        }} />
    </FormField>
    {open ? <div className="theme-popup absolute inset-x-0 top-full z-30 mt-1 min-w-0 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
      <div ref={list} id={`${id}-list`} role="listbox" aria-label="Available contacts" className="max-h-[min(16rem,35dvh)] overflow-y-auto overscroll-contain">
        {visible.map((contact, index) => <button key={contact.id} id={`${id}-option-${index}`} type="button" role="option" tabIndex={-1} aria-selected={index === active}
          className={`block min-h-11 w-full min-w-0 border-b p-2 text-left text-sm [overflow-wrap:anywhere] ${index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent"}`}
          onPointerDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => onSelect(contact)}>
          <span className="font-medium">{contact.name || contact.email || contact.phone}</span>
          <span className="block text-xs opacity-75">{[contact.position, contact.email, contact.phone].filter(Boolean).join(" · ")}</span>
        </button>)}
      </div>
      {!visible.length ? <p role="status" className="p-3 text-sm">No matching contacts.</p> : null}
      {matches.length > visible.length ? <p className="border-t p-2 text-xs">Showing 30 of {matches.length}. Type to narrow the results.</p> : null}
    </div> : null}
  </div>;
}

function AssignedContactSites({ sites = [], showHeading = false }) {
  return sites.length ? <div className="mt-1.5 min-w-0" aria-label="Assigned sites">
    {showHeading ? <p className="mb-1 text-xs text-text-secondary">Assigned sites (edit on the Site profile)</p> : null}
    <div className="flex min-w-0 flex-wrap gap-1">{sites.map((site) => <Badge key={site.siteId} variant="secondary" className="h-auto max-w-full whitespace-normal [overflow-wrap:anywhere]">{site.name}{site.isPrimary ? " · Primary" : ""}{site.roles.length ? ` · ${site.roles.join(", ")}` : ""}</Badge>)}</div>
  </div> : null;
}

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
      <AssignedContactSites sites={contact.sites} />
      {contact.notes ? <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">{contact.notes}</p> : null}
    </div>)}
  </div>;
}

// Draft changes are submitted with the owner record in one transaction. Only edited
// identities include `contact` or use onContactChange; related Site rows are display
// context and never enter the direct-assignment value without an explicit add.
export default function ContactAssignmentsEditor({ value = [], onChange, contacts = [], preferredContacts = [], relatedContacts = [], onContactChange, kind = "customer" }) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState("");
  const byId = new Map([...contacts, ...preferredContacts, ...relatedContacts].map((contact) => [contact.id, contact]));
  const relatedById = new Map(relatedContacts.map((contact) => [contact.id, contact]));
  const rows = [
    ...value.map((assignment) => ({ contactId: assignment.contactId, assignment })),
    ...relatedContacts.filter((contact) => contact.sites?.length && !value.some((assignment) => assignment.contactId === contact.id))
      .map((contact) => ({ contactId: contact.id, assignment: null })),
  ];
  const preferred = new Set(preferredContacts.map((contact) => contact.id));
  const candidates = [...byId.values()].filter((contact) => !value.some((assignment) => assignment.contactId === contact.id))
    .sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)) || (a.name || a.email || a.id).localeCompare(b.name || b.email || b.id));
  const update = (contactId, patch) => onChange(value.map((assignment) => assignment.contactId === contactId ? { ...assignment, ...patch }
    : patch.isPrimary ? { ...assignment, isPrimary: false } : assignment));
  const add = (contact, isNew = false) => {
    onChange([...value, { contactId: contact.id, roles: [], isPrimary: false, ...(kind === "customer" ? { isBilling: false } : {}), ...(isNew ? { contact } : {}) }]);
    setExpanded(contact.id); setAdding(false);
  };
  return <div className="@container grid min-w-0 gap-3 [&_button]:scroll-mb-28 [&_button]:scroll-mt-24" aria-label={`${kind === "customer" ? "Customer" : "Site"} contact management`}>
    <p className="text-xs text-text-secondary">{kind === "customer" ? "Remove from customer keeps this person available at their assigned sites. Account email and phone remain the billing fallback." : "Remove from site keeps this person available to other customers and sites."}</p>
    <div className="min-w-0 divide-y">{!rows.length ? <p className="py-3 text-sm text-text-secondary">No contacts assigned.</p> : null}{rows.map(({ contactId, assignment }) => {
      const contact = assignment?.contact || byId.get(contactId) || { id: contactId };
      const open = expanded === contactId;
      const fieldPrefix = `${id}-${contactId}`;
      const editContact = (next) => onContactChange && !assignment?.contact ? onContactChange(next) : update(contactId, { contact: next });
      return <section key={contactId} data-contact-id={contactId} className="min-w-0 py-3" aria-label={contact.name || contact.email || contact.phone || "New contact"}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1 basis-full [overflow-wrap:anywhere] @sm:basis-auto"><p className="font-medium">{contact.name || contact.email || contact.phone || "New contact"}</p><p className="text-xs text-text-secondary">{[contact.position, contact.phone, contact.email].filter(Boolean).join(" · ")}</p></div>
          <Button type="button" variant="ghost" aria-expanded={open} onClick={() => setExpanded(open ? "" : contactId)}>{open ? "Close details" : "Edit details"}</Button>
          {assignment ? <Button type="button" variant="outline" onClick={() => onChange(value.filter((entry) => entry.contactId !== contactId))}>Remove from {kind}</Button>
            : <Button type="button" variant="outline" onClick={() => add(contact)}>Assign to customer</Button>}
        </div>
        {kind === "customer" ? <div className="mt-1.5 flex min-w-0 flex-wrap gap-1">
          <Badge variant="secondary">{assignment ? "Customer contact" : "Site-only contact"}</Badge>
          {assignment?.isPrimary ? <Badge>Primary</Badge> : null}{assignment?.isBilling ? <Badge>Billing</Badge> : null}
          {contactRoles(assignment?.roles).map((role) => <Badge key={role} variant="outline" className="h-auto max-w-full whitespace-normal [overflow-wrap:anywhere]">{role}</Badge>)}
        </div> : null}
        <AssignedContactSites sites={relatedById.get(contactId)?.sites} showHeading />
        {open ? <div className="mt-3 grid min-w-0 gap-3 @sm:grid-cols-2">
          <p className="text-xs text-text-secondary @sm:col-span-2">Changes to this person's details appear everywhere they are assigned. Saved job contacts stay unchanged.</p>
          {[["name", "Name"], ["position", "Position"], ["phone", "Phone"], ["email", "Email"]].map(([key, label]) => <FormField key={key} label={label} htmlFor={`${fieldPrefix}-${key}`}><Input id={`${fieldPrefix}-${key}`} autoFocus={key === "name"} value={contact[key] || ""} onChange={(event) => editContact({ ...contact, [key]: event.target.value })} /></FormField>)}
          <div className="min-w-0 @sm:col-span-2"><FormField label="Notes" htmlFor={`${fieldPrefix}-notes`}><Textarea id={`${fieldPrefix}-notes`} rows={2} value={contact.notes || ""} onChange={(event) => editContact({ ...contact, notes: event.target.value })} /></FormField></div>
        </div> : null}
        {assignment ? <div className="mt-3 grid min-w-0 gap-2 @lg:grid-cols-[minmax(0,1fr)_auto]">
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
        </div> : null}
      </section>;
    })}</div>
    {adding ? <div className="min-w-0 rounded-lg border p-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Add contact method">
        <Button type="button" aria-pressed variant="default">Existing contact</Button>
        <Button type="button" aria-pressed={false} variant="outline" onClick={() => add({ id: crypto.randomUUID(), name: "", position: "", phone: "", email: "", notes: "" }, true)}>New contact</Button>
      </div>
      <ExistingContactPicker contacts={candidates} onSelect={(contact) => add(contact)} />
      <Button type="button" variant="ghost" className="mt-3" onClick={() => setAdding(false)}>Cancel adding</Button>
    </div> : <Button type="button" variant="outline" className="justify-self-start" onClick={() => setAdding(true)}>Add Contact</Button>}
  </div>;
}
