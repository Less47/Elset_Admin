import { cn } from "@/lib/utils";

export function MobileRecordList({ children, className, label }) {
  return (
    <ul
      className={cn("m-0 grid min-w-0 max-w-full list-none gap-2 p-0", className)}
      aria-label={label}
      data-mobile-record-list
    >
      {children}
    </ul>
  );
}

export function MobileRecordCard({ children, className, labelledBy, recordId }) {
  return (
    <li
      className={cn("data-record-card min-w-0 max-w-full overflow-hidden rounded-xl border bg-card p-3", className)}
      data-mobile-record-card
      data-record-id={recordId}
    >
      <article className="min-w-0" aria-labelledby={labelledBy}>
        {children}
      </article>
    </li>
  );
}

export function MobileRecordHeader({ children, className }) {
  return (
    <div className={cn("flex min-w-0 items-start justify-between gap-2", className)}>
      {children}
    </div>
  );
}

export function MobileRecordBody({ children, className }) {
  return (
    <div className={cn("mt-2 grid min-w-0 gap-1 text-sm text-text-secondary [&>*]:min-w-0 [&>*]:[overflow-wrap:anywhere]", className)}>
      {children}
    </div>
  );
}

export function MobileRecordStats({ children, className }) {
  return (
    <dl className={cn("mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border pt-2", className)}>
      {children}
    </dl>
  );
}

export function MobileRecordStat({ children, className, label }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function MobileRecordActions({ children, className }) {
  return (
    <div
      className={cn(
        "mt-3 flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-border pt-2.5 [&>button]:min-h-11 [&>button]:rounded-lg",
        className
      )}
    >
      {children}
    </div>
  );
}
