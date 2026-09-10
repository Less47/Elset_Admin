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

const desktopFieldSizeClassNames = {
  search: "page-controls__search",
  view: "page-controls__view-toggle",
  small: "page-controls__filter page-controls__filter--small",
  medium: "page-controls__filter page-controls__filter--medium",
  large: "page-controls__filter page-controls__filter--large",
  date: "page-controls__filter page-controls__filter--date",
};

export function DesktopPageControls({ search, viewToggle, filters, summary, actions, className }) {
  return (
    <div className={cn("page-controls floating-page-toolbar hidden px-4 py-3 xl:flex", className)} data-desktop-page-controls>
      <div className="page-controls__left">
        {search}
        {viewToggle}
        {filters}
      </div>
      {summary}
      {actions ? <div className="page-controls__right">{actions}</div> : null}
    </div>
  );
}

export function DesktopControlField({ children, className, htmlFor, label, size = "medium" }) {
  return (
    <div
      className={cn("page-controls__field", desktopFieldSizeClassNames[size] || desktopFieldSizeClassNames.medium, className)}
      data-control-size={size}
    >
      {htmlFor ? (
        <label htmlFor={htmlFor} className="page-controls__label">{label}</label>
      ) : (
        <span className="page-controls__label">{label}</span>
      )}
      {children}
    </div>
  );
}

export function ResponsivePageControls({ search, controls, action, summary, toolbarSummary, className, compact = false, surfaceClassName }) {
  return (
    <div className={cn("grid gap-2 xl:hidden", className)} data-responsive-page-controls>
      <div className={cn("floating-page-toolbar p-2.5 sm:p-3", surfaceClassName)}>
        <div className={cn(
          "grid gap-1.5",
          action && "md:grid-cols-[minmax(0,1fr)_auto]",
          compact && "grid-cols-[minmax(0,1fr)_auto] items-center"
        )}>
          <div className="min-w-0">{search}</div>
          {controls ? (
            <div className={cn(
              "order-2 flex min-w-0 items-stretch gap-1.5",
              action && "md:col-span-2 md:row-start-2",
              compact && "col-start-2 row-start-1"
            )}>
              {controls}
            </div>
          ) : null}
          {action ? (
            <div className="order-3 min-w-0 md:col-start-2 md:row-start-1 [&>button]:w-full md:[&>button]:w-auto">
              {action}
            </div>
          ) : null}
        </div>
        {toolbarSummary}
      </div>
      {summary}
    </div>
  );
}

export function PageSearchField({ value, onChange, placeholder, label, compact = false }) {
  return (
    <div className="relative min-w-0">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 !text-muted-foreground" aria-hidden="true" />
      <Input
        className={cn(
          "data-toolbar-field border-border bg-card pl-9 pr-11",
          compact ? "h-10 rounded-lg text-sm" : "h-11 rounded-xl text-base"
        )}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {value ? (
        <button
          type="button"
          className={cn(
            "absolute right-0 top-0 flex items-center justify-center !text-muted-foreground outline-none hover:!text-foreground focus-visible:ring-3 focus-visible:ring-status-info-border/35",
            compact ? "h-10 w-10 rounded-lg" : "h-11 w-11 rounded-xl"
          )}
          onClick={() => onChange("")}
          aria-label={compact ? "Clear search" : `Clear ${label.toLowerCase()}`}
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
        className="data-toolbar-field h-11 min-w-0 flex-[1.2] rounded-xl border-border bg-card px-2.5"
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

export function ViewModeToggle({ value, onChange, label = "View mode", compact = false }) {
  const options = [
    { value: "list", label: "List", Icon: List },
    { value: "grid", label: "Grid", Icon: LayoutGrid },
  ];

  return (
    <div
      className={cn("flex shrink-0 items-end gap-1.5", compact ? "h-10" : "h-11")}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const ViewIcon = option.Icon;
        return (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            "page-controls__view-button border border-border",
            compact ? "h-9 w-9 min-w-9 rounded-md p-0" : "h-11 min-w-11 rounded-lg px-2 sm:px-2.5",
            value === option.value
              ? "is-active"
              : "!text-foreground hover:!text-foreground"
          )}
          onClick={() => onChange(option.value)}
          aria-label={`${option.label} view`}
          aria-pressed={value === option.value}
          title={`${option.label} view`}
        >
          <ViewIcon className="h-4 w-4" aria-hidden="true" />
          <span className={compact ? "sr-only" : "hidden sm:inline"}>{option.label}</span>
        </Button>
        );
      })}
    </div>
  );
}

export function PagePrimaryAction({ children, className, compact = false, ...props }) {
  return (
    <Button className={cn(compact ? "h-10 rounded-lg px-3" : "h-11 rounded-xl px-3", className)} {...props}>
      {children}
    </Button>
  );
}

export function ResultSummary({ children, className }) {
  return (
    <p className={cn("px-1 text-sm font-medium text-text-secondary", className)} role="status" aria-live="polite" data-result-summary>
      {children}
    </p>
  );
}

export function FilterSheetField({ id, label, children }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
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
          className="flex items-start justify-between gap-3 border-b px-panel py-3"
          style={{
            paddingLeft: "calc(var(--panel-padding) + env(safe-area-inset-left))",
            paddingRight: "calc(var(--panel-padding) + env(safe-area-inset-right))",
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
          className="overscroll-contain p-panel"
          style={{
            paddingRight: "calc(var(--panel-padding) + env(safe-area-inset-right))",
            paddingLeft: "calc(var(--panel-padding) + env(safe-area-inset-left))",
          }}
        >
          <div className="grid gap-3">{children}</div>
        </DialogBody>

        <div
          className="flex shrink-0 items-center justify-between gap-3 border-t bg-card/90 px-panel py-2 backdrop-blur"
          style={{
            paddingRight: "calc(var(--panel-padding) + env(safe-area-inset-right))",
            paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))",
            paddingLeft: "calc(var(--panel-padding) + env(safe-area-inset-left))",
          }}
        >
          <Button type="button" variant="ghost" className="min-h-11 rounded-xl px-3" onClick={onReset} disabled={activeCount === 0}>
            Reset
          </Button>
          <DialogClose asChild>
            <Button type="button" className="min-h-11 rounded-xl px-4">Done</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
