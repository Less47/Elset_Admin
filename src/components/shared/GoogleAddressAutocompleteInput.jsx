import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { loadGooglePlaces, MISSING_ADDRESS_KEY_MESSAGE, PLACES_LOAD_ERROR_MESSAGE } from "@/components/map/google-maps-loader";
import { googlePlaceAddress } from "@/lib/google-place-address";
import { updatedSiteAddressMetadata } from "@/lib/site-location";

function withTimeout(request) {
  let timeout;
  return Promise.race([request, new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Address lookup timed out")), 12000);
  })]).finally(() => clearTimeout(timeout));
}

export function GoogleAddressAutocompleteInput({ value, onChange, onSelectionPending, onBlur, id, placeholder, className }) {
  const generatedId = useId();
  const inputId = id || `address-${generatedId}`;
  const listId = `${inputId}-suggestions`;
  const statusId = `${inputId}-status`;
  const [suggestions, setSuggestions] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const revision = useRef(0);
  const timer = useRef(null);
  const session = useRef(null);
  const selecting = useRef(false);
  const input = useRef(null);
  const open = suggestions.length > 0;

  useEffect(() => () => {
    revision.current += 1; clearTimeout(timer.current); onSelectionPending?.(false);
  }, [onSelectionPending]);
  useEffect(() => {
    if (highlight >= 0) document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [highlight, listId]);

  const dismiss = () => {
    revision.current += 1;
    clearTimeout(timer.current);
    session.current = null;
    setSuggestions([]);
    setHighlight(-1);
    setLoading(false);
    if (selecting.current) { selecting.current = false; onSelectionPending?.(false); }
  };

  const change = (address) => {
    const requestId = ++revision.current;
    clearTimeout(timer.current);
    setSuggestions([]);
    setHighlight(-1);
    setMessage("");
    setLoading(false);
    if (selecting.current) { selecting.current = false; onSelectionPending?.(false); }
    onChange({ ...updatedSiteAddressMetadata(value, { address }), address });
    if (address.trim().length < 3) { session.current = null; return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { AutocompleteSuggestion, AutocompleteSessionToken } = await withTimeout(loadGooglePlaces());
        if (requestId !== revision.current) return;
        session.current ||= new AutocompleteSessionToken();
        const { suggestions: results } = await withTimeout(AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: address.trim(), sessionToken: session.current,
          includedRegionCodes: ["au"], region: "au", language: "en-AU",
          locationBias: { center: { lat: -37.8136, lng: 144.9631 }, radius: 50000 },
        }));
        if (requestId !== revision.current) return;
        const predictions = results.map((result) => result.placePrediction).filter(Boolean);
        setSuggestions(predictions);
        if (!predictions.length) setMessage("No matching addresses. You can enter the address manually.");
      } catch (error) {
        if (requestId === revision.current) {
          session.current = null;
          setMessage(error?.code === "GOOGLE_MAPS_KEY_MISSING" ? MISSING_ADDRESS_KEY_MESSAGE : PLACES_LOAD_ERROR_MESSAGE);
        }
      } finally {
        if (requestId === revision.current) setLoading(false);
      }
    }, 250);
  };

  const select = async (prediction) => {
    const requestId = ++revision.current;
    clearTimeout(timer.current);
    setSuggestions([]);
    setHighlight(-1);
    setMessage("");
    setLoading(true);
    selecting.current = true;
    onSelectionPending?.(true);
    // toPlace carries the prediction's session into the single Details request.
    session.current = null;
    try {
      const place = prediction.toPlace();
      await withTimeout(place.fetchFields({ fields: ["addressComponents", "location"] }));
      if (requestId !== revision.current) return;
      const address = googlePlaceAddress(place);
      onChange({ ...updatedSiteAddressMetadata(value, address), ...address });
      setMessage("Address selected. Review it before saving.");
    } catch {
      if (requestId === revision.current) setMessage("Google Places could not load that address. Choose another suggestion or enter it manually.");
    } finally {
      if (requestId === revision.current) {
        setLoading(false); selecting.current = false; onSelectionPending?.(false);
      }
    }
  };

  return <div className="relative min-w-0" data-google-address-picker>
    <Input ref={input} id={inputId} value={value.address || ""} placeholder={placeholder} className={className}
      role="combobox" aria-label={!id ? "Address" : undefined} aria-autocomplete="list" aria-expanded={open}
      aria-controls={open ? listId : undefined} aria-activedescendant={highlight >= 0 && open ? `${listId}-${highlight}` : undefined}
      aria-describedby={loading || message ? statusId : undefined} autoComplete="off"
      onChange={(event) => change(event.target.value)}
      onBlur={(event) => { if (!selecting.current) dismiss(); onBlur?.(event); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { if (open || loading) event.preventDefault(); dismiss(); }
        else if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          setHighlight((current) => event.key === "ArrowDown" ? (current + 1) % suggestions.length : (current <= 0 ? suggestions.length : current) - 1);
        } else if (open && event.key === "Enter") {
          event.preventDefault(); void select(suggestions[highlight >= 0 ? highlight : 0]);
        }
      }} />
    {open ? <div className="theme-popup absolute inset-x-0 top-full z-50 mt-1 min-w-0 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg">
      <ul id={listId} role="listbox" aria-label="Australian address suggestions" className="max-h-[min(15rem,35dvh)] overflow-y-auto overscroll-contain py-1">
        {suggestions.map((prediction, index) => <li id={`${listId}-${index}`} key={prediction.placeId} role="option" aria-selected={index === highlight}>
          <button type="button" tabIndex={-1} className={`min-h-11 w-full px-3 py-2 text-left text-sm [overflow-wrap:anywhere] ${index === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent"}`}
            onPointerDown={(event) => event.preventDefault()} onMouseEnter={() => setHighlight(index)}
            onClick={() => { input.current?.focus(); void select(prediction); }}>
            {prediction.text.toString()}
          </button>
        </li>)}
      </ul>
      <div className="flex justify-end border-t px-3 py-2"><span translate="no" className="whitespace-nowrap rounded bg-white px-1 text-xs font-normal not-italic tracking-normal text-[#5e5e5e]">Google Maps</span></div>
    </div> : null}
    {loading || message ? <p id={statusId} role="status" className="mt-1 text-xs text-text-secondary">{loading ? selecting.current ? "Loading address…" : "Searching addresses…" : message}</p> : null}
  </div>;
}
