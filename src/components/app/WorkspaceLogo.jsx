import { useState } from "react";
import { Building2 } from "lucide-react";
import { isWorkspaceLogoUrl } from "@/lib/workspace-logo";

function LogoImage({ url, compact, dense }) {
  const [failed, setFailed] = useState(false);
  return url && !failed
    ? <img src={url} alt="Workspace logo" onError={() => setFailed(true)} className={`block h-auto w-auto object-contain ${compact ? "max-h-[38px] max-w-[38px]" : dense ? "max-h-12 max-w-[150px]" : "max-h-[70px] max-w-[150px]"}`} />
    : <Building2 data-workspace-logo-fallback className={compact ? "h-8 w-8" : "h-9 w-9"} role="img" aria-label="Workspace" />;
}

export default function WorkspaceLogo({ url, compact = false, dense = false, className = "" }) {
  const safeUrl = isWorkspaceLogoUrl(url) ? url : "";
  return (
    <div data-workspace-logo className={`flex shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground ${compact ? "h-12 w-12 p-1" : dense ? "h-16 w-full px-12 py-2" : "h-[86px] w-full px-3 py-2"} ${className}`}>
      <LogoImage key={safeUrl} url={safeUrl} compact={compact} dense={dense} />
    </div>
  );
}
