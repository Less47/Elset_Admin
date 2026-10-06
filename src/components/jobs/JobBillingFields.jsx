import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WARRANTY_REASON_MAX_LENGTH } from "@/lib/job-billing";

export default function JobBillingFields({ billingType, warrantyReason, onChange }) {
  const id = useId();
  return <div className="grid gap-3 sm:max-w-lg">
    <div className="grid gap-1.5 sm:max-w-xs">
      <Label htmlFor={`${id}-billing`}>Billing Type</Label>
      <Select value={billingType} onValueChange={value => onChange({ billingType: value })}>
        <SelectTrigger id={`${id}-billing`} className="h-11 w-full" aria-label="Billing Type"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="billable">Billable</SelectItem><SelectItem value="warranty">Warranty</SelectItem></SelectContent>
      </Select>
    </div>
    {billingType === "warranty" ? <>
      <p className="text-sm text-text-secondary">Warranty jobs are tracked as non-billable and cannot be invoiced while marked Warranty.</p>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-reason`}>Warranty Reason <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Input id={`${id}-reason`} className="h-11" value={warrantyReason} maxLength={WARRANTY_REASON_MAX_LENGTH} onChange={event => onChange({ warrantyReason: event.target.value })} placeholder="e.g. Installation warranty" />
      </div>
    </> : null}
  </div>;
}
