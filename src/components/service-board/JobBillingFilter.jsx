import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function JobBillingFilter({ value, onChange }) {
  const id = useId();
  return <div className="grid gap-1.5">
    <Label htmlFor={id}>Billing Type</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="h-11 w-full" aria-label="Billing Type filter"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="billable">Billable</SelectItem><SelectItem value="warranty">Warranty</SelectItem></SelectContent>
    </Select>
  </div>;
}
