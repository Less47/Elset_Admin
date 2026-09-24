import { Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMaintenanceFrequencyMeta, getMaintenancePlanStatus } from "@/lib/app-support";
import { effectiveMaintenancePlan, formatMaintenanceDate } from "@/lib/maintenance-recurrence";
import { money } from "@/lib/quote-template";

export default function ProfileMaintenanceContracts({ plans = [], jobs = [], onOpenPlan }) {
  if (!plans.length) return <p className="text-sm text-text-secondary">No maintenance contracts recorded.</p>;
  return <div className="grid min-w-0 gap-2">{plans.map((source) => {
    const plan = effectiveMaintenancePlan(source, jobs);
    const status = getMaintenancePlanStatus(plan, jobs);
    const priceSet = plan.contractPriceSet ?? Number(plan.contractPrice) > 0;
    return <article key={plan.id} className="min-w-0 rounded-lg border border-border bg-card p-3 text-card-foreground" data-profile-maintenance={plan.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]"><Wrench className="mr-1.5 inline h-4 w-4 text-status-maintenance" aria-hidden="true" />{plan.planName}</h3>
        <Badge className={status.className}>{status.label}</Badge>
      </div>
      <p className="mt-1 break-words text-xs text-text-secondary">{plan.siteAddress}</p>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-text-secondary">Frequency</dt><dd className="mt-0.5 font-medium">{getMaintenanceFrequencyMeta(plan.frequency).label}</dd></div>
        <div><dt className="text-text-secondary">Next service</dt><dd className="mt-0.5 font-medium">{plan.nextDueDate ? formatMaintenanceDate(plan.nextDueDate) : "Not set"}</dd></div>
        <div><dt className="text-text-secondary">Contract price</dt><dd className="mt-0.5 font-medium">{priceSet ? money(plan.contractPrice) : "Not set"}</dd></div>
      </dl>
      <div className="mt-2 flex justify-end"><Button type="button" variant="outline" size="sm" onClick={() => onOpenPlan(plan.id)}>Open contract</Button></div>
    </article>;
  })}</div>;
}
