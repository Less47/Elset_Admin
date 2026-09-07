import { useState } from "react";
import { FormField } from "@/components/shared/FormField";
import { Input } from "@/components/ui/input";
import { isHexColorDraftValid, normalizeHexColor } from "@/lib/app-support";

export default function ThemeColourField({ field, value, onChange }) {
  const [draft, setDraft] = useState(null);
  return (
    <div className="grid gap-2">
      <FormField label={field.label}>
        <div className="flex items-center gap-3">
          <Input
            type="color"
            aria-label={`${field.label} colour`}
            className="h-10 w-16 shrink-0 rounded-xl p-1"
            value={normalizeHexColor(value, "#0F172A")}
            onChange={(event) => {
              setDraft(null);
              onChange(field.key, event.target.value);
            }}
          />
          <Input
            aria-label={`${field.label} hex`}
            value={draft ?? value}
            onFocus={() => setDraft(value)}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              // Partial hex text stays in the editor, never reaching the API.
              if (isHexColorDraftValid(next)) onChange(field.key, normalizeHexColor(next, value));
            }}
            onBlur={() => setDraft(null)}
          />
        </div>
      </FormField>
      <p className="text-xs leading-5 text-slate-500">{field.description}</p>
    </div>
  );
}
