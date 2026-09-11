import { Label } from "@/components/ui/label";

export function FormField({ label, htmlFor, children }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
