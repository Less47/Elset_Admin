import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseEmailRecipients, recipientFields } from "@/lib/document-email";

export default function DocumentEmailComposer({ draft, onChange, suggestions = [], errors, disabled }) {
  const selected = new Set(recipientFields.flatMap((field) => draft[field]).map((address) => address.toLowerCase()));
  function addRecipients(field, value) {
    const parsed = parseEmailRecipients(value);
    if (parsed.invalid.length) return;
    const priority = recipientFields.indexOf(field);
    const used = new Set(recipientFields.slice(0, priority).flatMap((key) => draft[key]).map((address) => address.toLowerCase()));
    const next = { ...draft, [`${field}Input`]: "" };
    next[field] = [...draft[field], ...parsed.addresses].filter((address) => {
      if (used.has(address.toLowerCase())) return false;
      used.add(address.toLowerCase());
      return true;
    });
    for (const key of recipientFields.slice(priority + 1)) next[key] = draft[key].filter((address) => !used.has(address.toLowerCase()));
    onChange(next);
  }
  function recipients(field) {
    const label = field.toUpperCase() === "TO" ? "To" : field.toUpperCase();
    const inputKey = `${field}Input`;
    return <div className="document-field document-recipient-field">
      <label htmlFor={`email-${field}`}>{label}</label>
      <div className="document-recipient-chips" aria-label={`${label} recipients`}>
        {draft[field].map((address, index) => <span className="document-recipient-chip" key={`${address}-${index}`}>
          <span>{address}</span><button type="button" aria-label={`Remove ${address} from ${label}`} onClick={() => onChange({ ...draft, [field]: draft[field].filter((_, position) => position !== index) })}><X size={14} /></button>
        </span>)}
      </div>
      <div className="flex min-w-0 gap-2">
        <Input id={`email-${field}`} value={draft[inputKey] || ""} placeholder="Email address" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `email-${field}-error` : undefined}
          onChange={(event) => onChange({ ...draft, [inputKey]: event.target.value })}
          onBlur={() => addRecipients(field, draft[inputKey] || "")}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addRecipients(field, draft[inputKey] || ""); } }} />
        <Button type="button" variant="outline" aria-label={`Add ${label} recipients`} onClick={() => addRecipients(field, draft[inputKey] || "")}>Add</Button>
      </div>
      {errors[field] ? <p id={`email-${field}-error`} className="text-xs text-status-danger" role="alert">{errors[field]}</p> : null}
      {suggestions.some((contact) => !selected.has(contact.email.toLowerCase())) ? <select className="document-contact-select" aria-label={`Add saved contact to ${label}`} value="" onChange={(event) => addRecipients(field, event.target.value)}>
        <option value="">Add a saved contact…</option>
        {suggestions.filter((contact) => !selected.has(contact.email.toLowerCase())).map((contact) => <option key={contact.email.toLowerCase()} value={contact.email}>{contact.name} · {contact.role} · {contact.email}</option>)}
      </select> : null}
    </div>;
  }
  return <fieldset disabled={disabled} className="document-email-composer" aria-label="Email composer">
    {recipients("to")}
    {recipients("cc")}
    <details className="document-bcc"><summary>BCC (optional)</summary><p className="text-xs text-text-secondary">Hidden from other recipients.</p>{recipients("bcc")}</details>
    <div className="document-field"><label htmlFor="email-subject">Subject</label><Input id="email-subject" value={draft.subject} maxLength={998} aria-invalid={Boolean(errors.subject)} onChange={(event) => onChange({ ...draft, subject: event.target.value })} />{errors.subject ? <p role="alert" className="text-xs text-status-danger">{errors.subject}</p> : null}</div>
    <div className="document-field"><label htmlFor="email-message">Message</label><Textarea id="email-message" value={draft.message} rows={10} maxLength={100000} aria-invalid={Boolean(errors.message)} onChange={(event) => onChange({ ...draft, message: event.target.value })} />{errors.message ? <p role="alert" className="text-xs text-status-danger">{errors.message}</p> : null}</div>
    <p className="text-xs text-text-secondary">These changes apply to this email only.</p>
  </fieldset>;
}
