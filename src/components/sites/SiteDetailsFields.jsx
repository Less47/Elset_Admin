import { useId } from "react";
import { GoogleAddressAutocompleteInput } from "@/components/shared/GoogleAddressAutocompleteInput";
import { FormField } from "@/components/shared/FormField";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { siteTypeOptions } from "@/lib/app-support";

export default function SiteDetailsFields({ value, onChange, onSelectionPending, showLabel = false }) {
  const id = useId();
  const update = (key, next) => onChange((current) => ({ ...current, [key]: next }));
  return <>
    {showLabel ? <div className="sm:col-span-2"><FormField label="Site name / label" htmlFor={`${id}-label`}>
      <Input id={`${id}-label`} value={value.label} onChange={(event) => update("label", event.target.value)} />
    </FormField></div> : null}
    <div className={showLabel ? "sm:col-span-2" : undefined}><FormField label="Address" htmlFor={`${id}-address`}>
      <GoogleAddressAutocompleteInput id={`${id}-address`} value={value}
        onChange={(address) => onChange((current) => ({ ...current, ...address }))}
        onSelectionPending={onSelectionPending} placeholder="Search this site address" />
    </FormField></div>
    <FormField label="Site type" htmlFor={`${id}-type`}>
      <Select value={value.siteType || "not-set"} onValueChange={(next) => update("siteType", next === "not-set" ? "" : next)}>
        <SelectTrigger id={`${id}-type`} className="w-full"><SelectValue placeholder="Select site type" /></SelectTrigger>
        <SelectContent><SelectItem value="not-set">Not set</SelectItem>{siteTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    </FormField>
    <FormField label="OC number" htmlFor={`${id}-oc`}>
      <Input id={`${id}-oc`} value={value.ocNumber} onChange={(event) => update("ocNumber", event.target.value)} placeholder="e.g. PS123456" />
      <p className="text-sm text-muted-foreground">Owners Corporation / plan reference for this property.</p>
    </FormField>
    <FormField label="Access notes" htmlFor={`${id}-access`}>
      <Textarea id={`${id}-access`} rows={4} value={value.accessNotes} onChange={(event) => update("accessNotes", event.target.value)} placeholder="Gate code, parking, access windows, call-on-arrival details..." />
    </FormField>
    <FormField label="Site notes" htmlFor={`${id}-notes`}>
      <Textarea id={`${id}-notes`} rows={4} value={value.notes} onChange={(event) => update("notes", event.target.value)} placeholder="General site context, layout, recurring issues..." />
    </FormField>
  </>;
}
