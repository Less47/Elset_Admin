import { useState } from "react";
import { CalendarDays, LogOut, Menu, Plus, X } from "lucide-react";
import BuildIndicator from "@/components/app/BuildIndicator";
import WorkspaceLogo from "@/components/app/WorkspaceLogo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function MobileWorkspaceNavigation({
  activeSection,
  authUser,
  canManageBusiness,
  currentSection,
  items,
  onLogout,
  onNavigate,
  onNewJob,
  onOpenTomorrow,
  roleLabel,
  workspaceLogoUrl,
  themePalette,
  tomorrowCount,
  tomorrowSelected,
}) {
  const [open, setOpen] = useState(false);
  const activeItem = items.find((item) => item.id === activeSection);
  const pageTitle = activeSection === "settings"
    ? currentSection?.title || activeItem?.label
    : activeItem?.label || currentSection?.title || "Workspace";

  const handleNavigate = (sectionId) => {
    onNavigate(sectionId);
    setOpen(false);
  };

  return (
    <div className="mobile-workspace-navigation sticky top-0 z-40 lg:hidden">
      <Dialog open={open} onOpenChange={setOpen}>
        <header
          className="border-b shadow-sm"
          style={{
            ...themePalette.sidebarHeader,
            borderColor: themePalette.borderColor,
            paddingTop: "env(safe-area-inset-top)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
          }}
        >
          <div className="flex min-h-14 items-center gap-2 px-2.5 sm:px-4">
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-11 rounded-xl border-white/20 bg-current/10 p-0 text-inherit hover:bg-current/20 hover:text-inherit"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </DialogTrigger>

            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-base font-semibold leading-5">{pageTitle}</p>
              <p className="truncate text-[11px] leading-4 opacity-70">{roleLabel} workspace</p>
            </div>

            {activeSection === "service-board" ? (
              <Button
                type="button"
                className={`relative h-11 w-11 rounded-xl p-0 ${tomorrowSelected ? "ring-3 ring-border" : ""}`}
                style={themePalette.primaryButton}
                onClick={onOpenTomorrow}
                aria-label={`Tomorrow, ${tomorrowCount} planned ${tomorrowCount === 1 ? "job" : "jobs"}`}
                aria-pressed={tomorrowSelected}
                title="Tomorrow"
              >
                <CalendarDays className="h-5 w-5" />
                <span className="absolute -bottom-1 -right-1 inline-flex min-w-5 items-center justify-center rounded-full bg-card px-1 text-[10px] font-bold text-foreground shadow-sm">
                  {tomorrowCount}
                </span>
              </Button>
            ) : (
              <span className="h-11 w-11" aria-hidden="true" />
            )}
          </div>
        </header>

        <DialogContent
          className="left-0 top-0 h-[100dvh] max-h-none w-[min(88vw,22rem)] max-w-none translate-x-0 translate-y-0 gap-0 rounded-none rounded-r-3xl border-y-0 border-l-0 p-0 data-closed:slide-out-to-left-4 data-open:slide-in-from-left-4 motion-reduce:transition-none motion-reduce:data-closed:animate-none motion-reduce:data-open:animate-none"
          style={{
            ...themePalette.sidebarShell,
            backgroundImage: "none",
            color: themePalette.sidebarInactiveButton.color,
          }}
          showCloseButton={false}
        >
          <DialogHeader
            className="relative gap-0 border-b p-2"
            style={{
              borderColor: themePalette.borderColor,
              paddingTop: "calc(0.5rem + env(safe-area-inset-top))",
              paddingRight: "calc(0.5rem + env(safe-area-inset-right))",
              paddingLeft: "calc(0.5rem + env(safe-area-inset-left))",
            }}
          >
            <div className="relative">
              <WorkspaceLogo url={workspaceLogoUrl} dense />
              <DialogTitle className="sr-only">Application navigation</DialogTitle>
              <DialogDescription className="sr-only">Workspace navigation</DialogDescription>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="absolute right-1 top-1/2 h-11 w-11 -translate-y-1/2 rounded-xl p-0 text-inherit"
                  aria-label="Close navigation"
                >
                  <X className="h-5 w-5" />
                </Button>
              </DialogClose>
            </div>
          </DialogHeader>

          <nav
            aria-label="Application"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
            style={{
              paddingRight: "calc(0.75rem + env(safe-area-inset-right))",
              paddingLeft: "calc(0.75rem + env(safe-area-inset-left))",
            }}
          >
            <div className="grid gap-1.5">
              {items.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-2xl border px-3 py-2 text-left text-sm font-semibold outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50"
                    style={isActive ? themePalette.sidebarActiveButton : themePalette.sidebarInactiveButton}
                    onClick={() => handleNavigate(item.id)}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                      style={isActive ? themePalette.sidebarActiveIcon : themePalette.sidebarInactiveIcon}
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          <div
            className="shrink-0 border-t px-3 py-2"
            style={{
              borderColor: themePalette.borderColor,
              paddingRight: "calc(0.75rem + env(safe-area-inset-right))",
              paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
              paddingLeft: "calc(0.75rem + env(safe-area-inset-left))",
            }}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{authUser?.name || "Signed in"}</p>
                <p className="truncate text-xs capitalize" style={{ color: themePalette.sidebarInactiveMuted }}>
                  {authUser?.role || "staff"}{authUser?.username ? ` · ${authUser.username}` : ""}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl px-3"
                onClick={onLogout}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
            <div className="mt-2">
              <BuildIndicator style={{ color: themePalette.sidebarInactiveMuted }} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {canManageBusiness && activeSection === "service-board" ? (
        <Button
          type="button"
          className="fixed z-40 h-14 w-14 rounded-2xl p-0 shadow-xl lg:hidden"
          style={{
            ...themePalette.primaryButton,
            right: "calc(1.5rem + env(safe-area-inset-right))",
            bottom: "calc(0.75rem + env(safe-area-inset-bottom))",
          }}
          onClick={onNewJob}
          aria-label="Add job"
          title="Add job"
        >
          <Plus className="h-6 w-6" />
        </Button>
      ) : null}
    </div>
  );
}
