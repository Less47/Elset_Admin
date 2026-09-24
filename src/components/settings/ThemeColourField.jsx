import { FormField } from "@/components/shared/FormField";
import { Input } from "@/components/ui/input";
import { isHexColorDraftValid, normalizeHexColor } from "@/lib/app-support";

export default function ThemeColourField({ field, value, onChange }) {
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
              onChange(field.key, normalizeHexColor(event.target.value, value));
            }}
          />
          <Input
            aria-label={`${field.label} hex`}
            value={value}
            onChange={(event) => {
              const next = event.target.value;
              onChange(field.key, next);
            }}
            onBlur={() => { if (isHexColorDraftValid(value)) onChange(field.key, normalizeHexColor(value, value)); }}
          />
        </div>
      </FormField>
      <p className="text-xs leading-5 text-muted-foreground">{field.description}</p>
    </div>
  );
}
