import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const RECORD_WORKSPACE_WIDE_MAX_WIDTH = "max-w-[90rem]";

export function RecordWorkspace({
  backLabel = "Back",
  children,
  eyebrow = "",
  headerActions = null,
  maxWidth = "max-w-6xl",
  onBack,
  status = null,
  subtitle = "",
  title,
}) {
  return (
    <main className="record-workspace min-h-[100dvh] min-w-0 text-foreground">
      <header className="record-workspace-header sticky top-0 z-40 border-b backdrop-blur-xl lg:mx-[var(--content-padding-x-lg)] lg:rounded-xl lg:border lg:shadow-xl">
        <div
          className={`mx-auto flex min-h-16 w-full ${maxWidth} items-center gap-2 px-panel py-2 sm:gap-3`}
          style={{
            paddingTop: "calc(0.5rem + env(safe-area-inset-top))",
            paddingRight: "calc(var(--panel-padding) + env(safe-area-inset-right))",
            paddingLeft: "calc(var(--panel-padding) + env(safe-area-inset-left))",
          }}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="record-workspace-back h-11 w-11 shrink-0 rounded-lg border-white/35 bg-current/12 text-inherit hover:bg-current/22 hover:text-inherit"
            onClick={onBack}
            aria-label={`Back to ${backLabel}`}
            title={`Back to ${backLabel}`}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <div className="min-w-0 flex-1">
            {eyebrow ? <p className="record-workspace-eyebrow truncate text-[11px] font-bold uppercase tracking-[0.12em] opacity-75">{eyebrow}</p> : null}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="record-workspace-title truncate text-base font-semibold leading-5 sm:text-lg">{title}</h1>
              {status}
            </div>
            {subtitle ? <p className="record-workspace-subtitle mt-0.5 hidden truncate text-xs opacity-75 sm:block">{subtitle}</p> : null}
          </div>

          {headerActions ? <div className="flex shrink-0 items-center gap-2">{headerActions}</div> : null}
        </div>
      </header>

      <div className={`mx-auto w-full ${maxWidth} px-panel pb-24 pt-3 lg:px-[var(--content-padding-x-lg)] lg:pb-6 lg:pt-4`}>
        {children}
      </div>
    </main>
  );
}

export function WorkspaceSection({ children, description = "", id, panel = false, title, trailing = null }) {
  return (
    <section
      id={id}
      className={panel
        ? "record-major-panel scroll-mt-28 rounded-xl border p-panel"
        : "record-workspace-section scroll-mt-28"}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-5 text-foreground sm:text-lg">{title}</h2>
          {description ? <p className="mt-1 max-w-3xl text-sm leading-5 text-text-secondary">{description}</p> : null}
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function WorkspaceActionBar({ children, maxWidth = "max-w-6xl", status = null }) {
  return (
    <div
      className="record-workspace-action-bar fixed inset-x-0 bottom-0 z-40 border-t shadow-[0_-16px_36px_-30px_rgba(15,23,42,0.55)] backdrop-blur-xl lg:static lg:mt-4 lg:rounded-xl lg:border lg:shadow-sm"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className={`mx-auto flex min-h-15 w-full ${maxWidth} items-center justify-between gap-2 px-panel py-2`}>
        <div className="min-w-0 flex-1 text-xs font-medium text-text-secondary sm:text-sm" aria-live="polite">{status}</div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

export function UnsavedChangesDialog({ open, onDiscard, onKeepEditing }) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) onKeepEditing();
    }}>
      <DialogContent className="rounded-2xl sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg">Discard unsaved changes?</DialogTitle>
          <DialogDescription>
            Your changes on this page have not been saved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-end">
          <Button type="button" variant="outline" onClick={onKeepEditing}>Keep editing</Button>
          <Button type="button" variant="destructive" onClick={onDiscard}>Discard</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceMessage({ children, tone = "neutral" }) {
  const toneClass = tone === "error"
    ? "border-status-danger-border bg-status-danger-surface text-status-danger"
    : tone === "success"
      ? "border-status-success-border bg-status-success-surface text-status-success"
      : "record-empty-state";

  return <div className={`rounded-lg px-4 py-3 text-sm ${tone === "neutral" ? "" : "border"} ${toneClass}`}>{children}</div>;
}
