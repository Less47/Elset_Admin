import { useState } from "react";
import { Building2 } from "lucide-react";
import { isWorkspaceBrandingUrl } from "@/lib/workspace-logo";

function BrandImage({ url, variant, dense, preview }) {
  const [failed, setFailed] = useState(false);
  const mark = variant === "mark";
  return url && !failed
    ? <img src={url} alt={mark ? "Workspace brand mark" : "Workspace logo"} onError={() => setFailed(true)} className={`block h-auto w-auto object-contain ${mark ? preview ? "max-h-14 max-w-14" : "max-h-9 max-w-9" : dense || preview ? "max-h-12 max-w-[150px]" : "max-h-16 max-w-[180px]"}`} />
    : <Building2 {...(mark ? { "data-workspace-brand-mark-fallback": "" } : { "data-workspace-logo-fallback": "" })} className={mark ? "h-8 w-8" : "h-9 w-9"} role="img" aria-label="Workspace" />;
}

function WorkspaceBrandAsset({ url, variant, dense = false, preview = false, className = "" }) {
  // Blob URLs are permitted only in an explicitly local Settings preview.
  const safeUrl = isWorkspaceBrandingUrl(variant, url) || (preview && url?.startsWith("blob:")) ? url : "";
  const mark = variant === "mark";
  return (
    <div {...(mark ? { "data-workspace-brand-mark": "" } : { "data-workspace-logo": "" })} className={`flex shrink-0 items-center justify-center ${mark ? preview ? "h-16 w-16" : "h-12 w-12" : dense ? "h-16 w-full px-12 py-2" : preview ? "h-16 w-full" : "h-20 w-full px-3 py-2"} ${className}`}>
      <BrandImage key={safeUrl} url={safeUrl} variant={variant} dense={dense} preview={preview} />
    </div>
  );
}

export default function WorkspaceLogo(props) {
  return <WorkspaceBrandAsset {...props} variant="logo" />;
}

export function WorkspaceBrandMark(props) {
  return <WorkspaceBrandAsset {...props} variant="mark" />;
}
