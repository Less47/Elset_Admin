import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SettingsSaveButton } from "./SettingsDraftScope";

export default function AddonDetails({ addon, open, onOpenChange, children, scope, returnFocusRef }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90dvh] sm:max-w-2xl" onCloseAutoFocus={(event) => {
      if (returnFocusRef?.current) { event.preventDefault(); returnFocusRef.current.focus(); }
    }}>
      <DialogHeader><DialogTitle>{addon.name}</DialogTitle><DialogDescription>{addon.description}</DialogDescription></DialogHeader>
      <DialogBody className="space-y-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">{addon.includes?.map(item => <li key={item}>• {item}</li>)}</ul>
        {children}
      </DialogBody>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>{scope ? <SettingsSaveButton scope={scope} /> : null}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
