import { warrantyBadgeClassName } from "@/lib/job-billing";

export default function ServiceBoardIndicatorSymbol({ indicator, showLabel = false, dotSizeClassName = "h-2 w-2" }) {
  if (indicator.type === "warranty") return <span data-service-board-indicator="warranty" className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-4 tracking-wide ${warrantyBadgeClassName}`}>WARRANTY</span>;
  if (indicator.type !== "quickbooks-warning") {
    return <span className={`${dotSizeClassName} shrink-0 rounded-full ${indicator.dotClassName}`} aria-hidden="true" />;
  }

  return (
    <span
      role="img"
      aria-label={indicator.label}
      title={indicator.label}
      data-service-board-indicator={indicator.id}
      data-indicator-expanded={showLabel}
      className={`inline-flex min-w-0 max-w-full items-center justify-center rounded-full bg-emerald-700 text-[10px] font-semibold uppercase leading-4 tracking-wide text-white ${showLabel ? "gap-1.5 px-1.5 py-0.5" : "h-[18px] w-[18px] shrink-0 p-0"}`}
    >
      <span
        aria-hidden="true"
        data-quickbooks-warning-centre
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-extrabold leading-none text-emerald-700"
      >!</span>
      {showLabel ? <span className="min-w-0 [overflow-wrap:anywhere]">{indicator.label}</span> : null}
    </span>
  );
}
