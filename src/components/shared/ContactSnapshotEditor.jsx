import { useId } from "react";
import { FormField } from "@/components/shared/FormField";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildContactSnapshot, getContactDisplayName } from "@/lib/app-support";

const NOT_SET_VALUE = "__none__";
const CUSTOM_VALUE = "__custom__";

function hasContactContent(contact) {
  return Boolean(
    String(contact?.name || "").trim()
      || String(contact?.phone || "").trim()
      || String(contact?.email || "").trim()
  );
}

function buildDraftContact(contact, fallbackRole = "") {
  return {
    id: String(contact?.id || "").trim(),
    name: String(contact?.name ?? ""),
    role: String(contact?.role ?? fallbackRole),
    phone: String(contact?.phone ?? ""),
    email: String(contact?.email ?? ""),
  };
}

function getSelectValue(contact, contacts) {
  const contactId = String(contact?.id || "").trim();
  if (contactId && contacts.some((entry) => entry.id === contactId)) {
    return contactId;
  }
  return hasContactContent(contact) ? CUSTOM_VALUE : NOT_SET_VALUE;
}

export default function ContactSnapshotEditor({
  title,
  description = "",
  value,
  contacts = [],
  fallbackRole = "",
  onChange,
}) {
  const fieldId = useId();
  const draftContact = buildDraftContact(value, fallbackRole);
  const selectValue = getSelectValue(value, contacts);

  const handleSelectValue = (nextValue) => {
    if (nextValue === NOT_SET_VALUE) {
      onChange(null);
      return;
    }

    if (nextValue === CUSTOM_VALUE) {
      onChange(draftContact);
      return;
    }

    const selectedContact = contacts.find((contact) => contact.id === nextValue) || null;
    onChange(buildContactSnapshot(selectedContact, fallbackRole));
  };

  const handleFieldChange = (key, nextValue) => {
    const linkedContact = contacts.find((contact) => contact.id === draftContact.id) || null;
    const nextContact = {
      ...draftContact,
      [key]: nextValue,
      // Editing a selected customer contact creates a job-specific snapshot.
      id: linkedContact ? "" : draftContact.id,
    };

    // Keep raw input authoritative while typing; persistence normalizes the snapshot.
    onChange(nextContact);
  };

  return (
    <div className="contact-snapshot-editor rounded-2xl border border-border bg-card p-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>

      <div className="mt-3 grid gap-3">
        <FormField label="Saved customer contact" htmlFor={`${fieldId}-saved`}>
          <Select value={selectValue} onValueChange={handleSelectValue}>
            <SelectTrigger id={`${fieldId}-saved`}>
              <SelectValue placeholder="Choose a saved customer contact" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOT_SET_VALUE}>Not set</SelectItem>
              {selectValue === CUSTOM_VALUE ? <SelectItem value={CUSTOM_VALUE}>Custom job contact</SelectItem> : null}
              {contacts.map((contact) => (
                <SelectItem key={contact.id} value={contact.id}>
                  {getContactDisplayName(contact)}{contact.role ? ` - ${contact.role}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        {contacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No saved customer contacts yet. You can still type a one-off contact for this job.</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" htmlFor={`${fieldId}-name`}>
            <Input
              id={`${fieldId}-name`}
              value={draftContact.name}
              onChange={(event) => handleFieldChange("name", event.target.value)}
              placeholder="Contact name"
            />
          </FormField>
          <FormField label="Role" htmlFor={`${fieldId}-role`}>
            <Input
              id={`${fieldId}-role`}
              value={draftContact.role}
              onChange={(event) => handleFieldChange("role", event.target.value)}
              placeholder={fallbackRole || "Role"}
            />
          </FormField>
          <FormField label="Phone" htmlFor={`${fieldId}-phone`}>
            <Input
              id={`${fieldId}-phone`}
              value={draftContact.phone}
              onChange={(event) => handleFieldChange("phone", event.target.value)}
              placeholder="Phone number"
            />
          </FormField>
          <FormField label="Email" htmlFor={`${fieldId}-email`}>
            <Input
              id={`${fieldId}-email`}
              value={draftContact.email}
              onChange={(event) => handleFieldChange("email", event.target.value)}
              placeholder="Email address"
            />
          </FormField>
        </div>
      </div>
    </div>
  );
}
