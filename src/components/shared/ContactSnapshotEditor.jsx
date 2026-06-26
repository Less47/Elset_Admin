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
    name: String(contact?.name || "").trim(),
    role: String(contact?.role || fallbackRole || "").trim(),
    phone: String(contact?.phone || "").trim(),
    email: String(contact?.email || "").trim(),
  };
}

function buildCommittedContact(contact, fallbackRole = "") {
  const draft = buildDraftContact(contact, fallbackRole);
  if (!hasContactContent(draft)) return null;
  return draft;
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
  const draftContact = buildDraftContact(value, fallbackRole);
  const selectValue = getSelectValue(value, contacts);

  const handleSelectValue = (nextValue) => {
    if (nextValue === NOT_SET_VALUE) {
      onChange(null);
      return;
    }

    if (nextValue === CUSTOM_VALUE) {
      onChange(buildCommittedContact(draftContact, fallbackRole));
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

    onChange(buildCommittedContact(nextContact, fallbackRole));
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {description ? <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p> : null}
      </div>

      <div className="mt-4 grid gap-4">
        <FormField label="Saved customer contact">
          <Select value={selectValue} onValueChange={handleSelectValue}>
            <SelectTrigger>
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
          <p className="text-xs text-slate-500">No saved customer contacts yet. You can still type a one-off contact for this job.</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name">
            <Input
              value={draftContact.name}
              onChange={(event) => handleFieldChange("name", event.target.value)}
              placeholder="Contact name"
            />
          </FormField>
          <FormField label="Role">
            <Input
              value={draftContact.role}
              onChange={(event) => handleFieldChange("role", event.target.value)}
              placeholder={fallbackRole || "Role"}
            />
          </FormField>
          <FormField label="Phone">
            <Input
              value={draftContact.phone}
              onChange={(event) => handleFieldChange("phone", event.target.value)}
              placeholder="Phone number"
            />
          </FormField>
          <FormField label="Email">
            <Input
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
