import { useEffect, useId, useRef, useState } from "react";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MAX_RESULTS = 8;

export default function SiteCustomerPicker({ customers, value, onChange }) {
  const id = useId();
  const input = useRef(null);
  const list = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const selected = customers.find((customer) => customer.id === value);
  const search = query.trim().toLowerCase();
  const matches = customers.filter((customer) => [customer.name, customer.email, customer.phone, customer.address, customer.postalAddress]
    .some((field) => String(field || "").toLowerCase().includes(search)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const visible = matches.slice(0, MAX_RESULTS);
  const activeId = open && visible[active] ? `${id}-option-${active}` : undefined;
  useEffect(() => { if (activeId) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [activeId]);
  const select = (customer) => { onChange(customer.id); setQuery(""); setOpen(false); setActive(-1); input.current?.focus(); };
  const change = () => { onChange(""); setQuery(""); setOpen(true); setActive(-1); input.current?.focus(); };

  return <div className="relative min-w-0 sm:col-span-2" data-site-customer-field onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <FormField label="Customer" htmlFor={id}>
      <div className="flex min-w-0 gap-2">
        <Input ref={input} id={id} role="combobox" aria-required="true" autoComplete="off" placeholder="Search customer..."
          value={selected ? selected.name : query} readOnly={Boolean(selected)} aria-autocomplete="list" aria-expanded={open && !selected}
          aria-controls={open ? `${id}-list` : undefined} aria-activedescendant={activeId}
          onFocus={() => { if (!selected) setOpen(true); }} onClick={() => { if (!selected) setOpen(true); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(-1); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); if (selected) { change(); return; } setOpen(true);
              setActive((index) => !visible.length ? -1 : index < 0 ? (event.key === "ArrowDown" ? 0 : visible.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length);
            } else if (event.key === "Enter") {
              event.preventDefault(); if (open && visible[active]) select(visible[active]); else if (selected) change(); else setOpen(true);
            } else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); }
          }} />
        {selected ? <Button type="button" variant="outline" className="shrink-0" onClick={change}>Change customer</Button> : null}
      </div>
      {selected ? <p className="text-xs text-text-secondary [overflow-wrap:anywhere]">{[selected.email, selected.phone, selected.address || selected.postalAddress].filter(Boolean).join(" · ")}</p> : null}
    </FormField>
    {open && !selected ? <div className="theme-popup absolute inset-x-0 top-full z-30 mt-1 min-w-0 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
      <div ref={list} id={`${id}-list`} role="listbox" aria-label="Available customers" className="max-h-[min(18rem,40dvh)] overflow-y-auto overscroll-contain">
        {visible.map((customer, index) => <button key={customer.id} id={`${id}-option-${index}`} type="button" role="option" tabIndex={-1} aria-selected={index === active}
          className={`block min-h-11 w-full min-w-0 border-b p-3 text-left text-sm [overflow-wrap:anywhere] ${index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent"}`}
          onPointerDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => select(customer)}>
          <span className="font-medium">{customer.name}</span>
          <span className="block text-xs opacity-75">{[customer.email, customer.phone].filter(Boolean).join(" · ")}</span>
          <span className="block text-xs opacity-75">{customer.address || customer.postalAddress}</span>
        </button>)}
      </div>
      {!visible.length ? <p role="status" className="p-3 text-sm">{customers.length ? "No matching customers." : "No customers available. Create a Customer first."}</p> : null}
      {matches.length > MAX_RESULTS ? <p className="border-t p-2 text-xs">Showing {MAX_RESULTS} of {matches.length}. Type to narrow the results.</p> : null}
    </div> : null}
  </div>;
}
