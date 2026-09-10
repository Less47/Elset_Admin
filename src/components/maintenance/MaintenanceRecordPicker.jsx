import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function MaintenanceRecordPicker({ label, placeholder, items, value, onSelect, disabled = false, required = false }) {
  const id = useId();
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const selected = items.find((entry) => entry.id === value);
  const terms = String(query || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = items.filter((entry) => terms.every((term) => entry.searchText.toLowerCase().includes(term)));
  const visible = matches.slice(0, 20);
  const expanded = open && !disabled;
  const activeId = expanded && visible[active] ? `${id}-option-${active}` : undefined;
  useEffect(() => {
    if (activeId) listRef.current?.querySelector(`[id="${activeId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function choose(item) {
    onSelect(item?.id || ""); setQuery(null); setOpen(false); setActive(-1);
  }
  return <div className="maintenance-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <div className="relative mt-1.5">
      <Search className="maintenance-picker-icon" aria-hidden="true" />
      <Input id={id} ref={inputRef} role="combobox" autoComplete="off" spellCheck={false} required={required} disabled={disabled}
        className="h-11 pl-9 pr-10" placeholder={placeholder} value={query ?? selected?.label ?? ""}
        aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-list` : undefined} aria-activedescendant={activeId}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(-1); if (value) onSelect(""); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive((index) => !visible.length ? -1 : index < 0 ? (event.key === "ArrowDown" ? 0 : visible.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length);
          } else if (event.key === "Enter" && expanded) {
            event.preventDefault(); if (visible[active]) choose(visible[active]);
          } else if (event.key === "Escape" && expanded) {
            event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1);
          }
        }} />
      {value || query ? <button type="button" className="maintenance-picker-clear" aria-label={`Clear ${label.toLowerCase()}`} disabled={disabled}
        onClick={() => { choose(null); inputRef.current?.focus(); setOpen(true); }}><X className="h-4 w-4" aria-hidden="true" /></button> : null}
      {expanded ? <div className="maintenance-picker-results">
        <div ref={listRef} id={`${id}-list`} role="listbox" aria-label={`${label} results`} className="maintenance-picker-list">
          {visible.map((item, index) => <button type="button" role="option" id={`${id}-option-${index}`} key={item.id} tabIndex={-1}
            aria-selected={item.id === value} className={`maintenance-picker-option ${index === active ? "is-active" : ""}`}
            onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(item)}>
            <span className="block truncate text-sm font-medium">{item.label}</span>
            {item.description ? <span className="block truncate text-xs opacity-75">{item.description}</span> : null}
          </button>)}
        </div>
        {!visible.length ? <p role="status" className="px-3 py-3 text-xs">No matching {label.toLowerCase()} records.</p> : null}
        {matches.length > visible.length ? <p className="border-t px-3 py-2 text-xs">Showing 20 of {matches.length}. Type to narrow the results.</p> : null}
      </div> : null}
    </div>
  </div>;
}
