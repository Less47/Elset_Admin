import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import WorkspaceLogo, { WorkspaceBrandMark } from "./WorkspaceLogo";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function SidebarTooltip({ compact, label, children }) {
  return compact ? <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent side="right" sideOffset={16}>{label}</TooltipContent></Tooltip> : children;
}

export default function WorkspaceSidebar({ activeSection, items, onNavigate, onLogout, authUser, isAuthenticated, themeSettings }) {
  const compact = themeSettings.sidebarWidth === "icon-only";
  const [accountOpen, setAccountOpen] = useState(false);
  const accountButton = useRef(null);
  const name = authUser?.name || "Signed in";
  const role = authUser?.role || "staff";
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  const renderItem = (item) => {
    const Icon = item.icon;
    return <SidebarTooltip key={item.id} compact={compact} label={item.label}>
      <button type="button" className="workspace-sidebar-item" onClick={() => onNavigate(item.id)} aria-label={item.label} aria-current={activeSection === item.id ? "page" : undefined}>
        <Icon className="workspace-sidebar-icon" aria-hidden="true" />
        {!compact ? <span>{item.label}</span> : null}
      </button>
    </SidebarTooltip>;
  };

  return (
    <TooltipProvider delayDuration={200}>
      <aside className="workspace-sidebar hidden lg:flex" data-compact={compact} aria-label="Workspace sidebar">
        <div className="workspace-sidebar-brand">
          {compact ? <WorkspaceBrandMark url={themeSettings.workspaceBrandMarkUrl} /> : <WorkspaceLogo url={themeSettings.workspaceLogoUrl} />}
        </div>
        <nav aria-label="Application" className="workspace-sidebar-navigation">
          <div className="workspace-sidebar-scroll">
            {items.filter(item => item.id !== "recycle-bin").map(renderItem)}
          </div>
          {items.some(item => item.id === "recycle-bin") ? <div className="workspace-sidebar-recycle">{items.filter(item => item.id === "recycle-bin").map(renderItem)}</div> : null}
        </nav>
        <div className="workspace-sidebar-account">
          <SidebarTooltip compact={compact} label={`Account · ${name} · ${role}`}>
            <button ref={accountButton} type="button" className="workspace-sidebar-item workspace-sidebar-user" aria-label="Account" onClick={() => setAccountOpen(true)} aria-haspopup="dialog">
              <span className="workspace-sidebar-avatar" aria-hidden="true">{initials}</span>
              {!compact ? <span className="workspace-sidebar-user-details"><span>{name}</span><span className="capitalize">{role}</span></span> : null}
            </button>
          </SidebarTooltip>
          {isAuthenticated ? <SidebarTooltip compact={compact} label="Log out">
            <button type="button" className="workspace-sidebar-item workspace-sidebar-logout" aria-label="Sign Out" onClick={onLogout}>
              <LogOut className="workspace-sidebar-icon" aria-hidden="true" />{!compact ? <span>Sign Out</span> : null}
            </button>
          </SidebarTooltip> : null}
        </div>
      </aside>
      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent className="sm:max-w-sm" onCloseAutoFocus={(event) => { event.preventDefault(); accountButton.current?.focus(); }}>
          <DialogHeader><DialogTitle>Account</DialogTitle><DialogDescription>Signed in as {name}.</DialogDescription></DialogHeader>
          <p className="text-sm capitalize">{role}</p>
          {authUser?.username ? <p className="text-sm text-text-secondary">{authUser.username}</p> : null}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
