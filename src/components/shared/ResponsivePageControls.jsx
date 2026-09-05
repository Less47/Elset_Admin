import { forwardRef } from "react";
import { ArrowDownUp, LayoutGrid, List, Search, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const responsiveSheetClassName = "bottom-0 left-0 top-auto max-h-[min(90dvh,50rem)] w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-b-none rounded-t-3xl border-x-0 border-b-0 p-0 data-closed:slide-out-to-bottom-4 data-open:slide-in-from-bottom-4 motion-reduce:transition-none motion-reduce:data-closed:animate-none motion-reduce:data-open:animate-none sm:left-1/2 sm:w-[min(100%-2rem,42rem)] sm:-translate-x-1/2 sm:rounded-b-3xl sm:border-x sm:border-b";

export function ResponsivePageControls({ search, controls, action, summary, className }) {
  return (
    <div className={cn("grid gap-2 xl:hidden", className)} data-responsive-page-controls>
      <div className="floating-page-toolbar px-3 py-3 sm:px-4">
        <div className={cn("grid gap-2", action && "md:grid-cols-[minmax(0,1fr)_auto]")}>
          <div className="min-w-0">{search}</div>
          {controls ? (
            <div className={cn("order-2 flex min-w-0 items-stretch gap-2", action && "md:col-span-2 md:row-start-2")}>
              {controls}
            </div>
          ) : null}
          {action ? (
            <div className="order-3 min-w-0 md:col-start-2 md:row-start-1 [&>button]:w-full md:[&>button]:w-auto">
              {action}
            </div>
          ) : null}
        </div>
      </div>
      {summary}
    </div>
  );
}

export function PageSearchField({ value, onChange, placeholder, label }) {
  return (
    <div className="relative min-w-0">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 !text-slate-500" aria-hidden="true" />
      <Input
        className="data-toolbar-field h-11 rounded-xl border-slate-300 bg-white pl-9 pr-11 text-base"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {value ? (
        <button
          type="button"
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl !text-slate-500 outline-none hover:!text-slate-900 focus-visible:ring-3 focus-visible:ring-sky-500/35"
          onClick={() => onChange("")}
          aria-label={`Clear ${label.toLowerCase()}`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export const FilterButton = forwardRef(function FilterButton({ activeCount = 0, onClick, label = "Filters", open = false }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      className="data-toolbar-button relative h-11 min-w-0 flex-1 rounded-xl px-2.5"
      onClick={onClick}
      aria-label={`${label}${activeCount ? `, ${activeCount} active` : ""}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-active-count={activeCount}
    >
      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
      {activeCount ? (
        <Badge className="h-5 min-w-5 justify-center rounded-full bg-sky-700 px-1 text-[10px] text-white">
          {activeCount}
        </Badge>
      ) : null}
    </Button>
  );
});

export function CompactSortControl({ value, onValueChange, options, label }) {
  const selectedLabel = options.find((option) => option.value === value)?.label || value;
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className="data-toolbar-field h-11 min-w-0 flex-[1.2] rounded-xl border-slate-300 bg-white px-2.5"
        aria-label={`${label}: ${selectedLabel}`}
      >
        <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Sort:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ViewModeToggle({ value, onChange, label = "View mode" }) {
  const options = [
    { value: "list", label: "List", Icon: List },
    { value: "grid", label: "Grid", Icon: LayoutGrid },
  ];

  return (
    <div className="data-toggle-shell flex h-11 shrink-0 gap-1 rounded-xl border border-slate-300 bg-white p-1" role="group" aria-label={label}>
      {options.map((option) => {
        const ViewIcon = option.Icon;
        return (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            "h-full min-w-9 rounded-lg px-2 sm:min-w-0 sm:px-2.5",
            value === option.value
              ? "!bg-slate-950 !text-white hover:!bg-slate-950 hover:!text-white"
              : "!text-slate-800 hover:!text-slate-950"
          )}
          onClick={() => onChange(option.value)}
          aria-label={`${option.label} view`}
          aria-pressed={value === option.value}
        >
          <ViewIcon className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{option.label}</span>
        </Button>
        );
      })}
    </div>
  );
}

export function PagePrimaryAction({ children, className, ...props }) {
  return (
    <Button className={cn("h-11 rounded-xl px-4", className)} {...props}>
      {children}
    </Button>
  );
}

export function ResultSummary({ children }) {
  return (
    <p className="px-1 text-sm font-medium text-slate-700" role="status" aria-live="polite" data-result-summary>
      {children}
    </p>
  );
}

export function FilterSheetField({ id, label, children }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
        {label}
      </label>
      {children}
    </div>
  );
}

export function MobileFilterSheet({
  activeCount = 0,
  children,
  description = "Refine the records shown on this page.",
  onOpenChange,
  onReset,
  open,
  returnFocusRef,
  title = "Filters",
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={responsiveSheetClassName}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef?.current?.focus();
        }}
      >
        <div
          className="flex items-start justify-between gap-3 border-b px-4 pb-3 pt-4 sm:px-5"
          style={{
            paddingLeft: "calc(1rem + env(safe-area-inset-left))",
            paddingRight: "calc(1rem + env(safe-area-inset-right))",
          }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
              {activeCount ? <Badge variant="secondary">{activeCount} active</Badge> : null}
            </div>
            <DialogDescription className="mt-1">{description}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button type="button" variant="ghost" className="h-11 w-11 shrink-0 rounded-xl p-0" aria-label={`Close ${title.toLowerCase()}`}>
              <X className="h-5 w-5" aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>

        <DialogBody
          className="overscroll-contain px-4 py-4 sm:px-5"
          style={{
            paddingRight: "calc(1rem + env(safe-area-inset-right))",
            paddingLeft: "calc(1rem + env(safe-area-inset-left))",
          }}
        >
          <div className="grid gap-4">{children}</div>
        </DialogBody>

        <div
          className="flex shrink-0 items-center justify-between gap-3 border-t bg-white/90 px-4 py-3 backdrop-blur sm:px-5"
          style={{
            paddingRight: "calc(1rem + env(safe-area-inset-right))",
            paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
            paddingLeft: "calc(1rem + env(safe-area-inset-left))",
          }}
        >
          <Button type="button" variant="ghost" className="min-h-11 rounded-xl px-3" onClick={onReset} disabled={activeCount === 0}>
            Reset
          </Button>
          <DialogClose asChild>
            <Button type="button" className="min-h-11 rounded-xl px-6">Done</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
