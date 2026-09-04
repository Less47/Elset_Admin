import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MIN_QUERY_LENGTH = 3;

async function fetchAddressSuggestions(query, signal) {
  const response = await fetch(`/api/address/autocomplete?q=${encodeURIComponent(query)}`, {
    method: "GET",
    signal,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Address lookup failed.");
  }

  return Array.isArray(payload?.suggestions) ? payload.suggestions : [];
}

export function AddressAutocompleteInput({
  className,
  disabled = false,
  onBlur,
  onChange,
  onFocus,
  onSelectSuggestion,
  placeholder = "Search an address",
  value,
  ...props
}) {
  const listboxId = useId();
  const lastSelectedValueRef = useRef("");
  const [isFocused, setIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [hasResolvedQuery, setHasResolvedQuery] = useState(false);

  const query = String(value || "").trim();
  const showDropdown =
    isFocused &&
    query.length >= MIN_QUERY_LENGTH &&
    (isLoading || errorMessage || suggestions.length > 0 || hasResolvedQuery);

  useEffect(() => {
    if (!isFocused || disabled) {
      setIsLoading(false);
      setSuggestions([]);
      setErrorMessage("");
      setHighlightedIndex(-1);
      setHasResolvedQuery(false);
      return undefined;
    }

    if (query.length < MIN_QUERY_LENGTH) {
      setIsLoading(false);
      setSuggestions([]);
      setErrorMessage("");
      setHighlightedIndex(-1);
      setHasResolvedQuery(false);
      return undefined;
    }

    if (query === lastSelectedValueRef.current) {
      setIsLoading(false);
      setSuggestions([]);
      setErrorMessage("");
      setHighlightedIndex(-1);
      setHasResolvedQuery(false);
      return undefined;
    }

    setSuggestions([]);
    setErrorMessage("");
    setHighlightedIndex(-1);
    setHasResolvedQuery(false);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true);

      try {
        const nextSuggestions = await fetchAddressSuggestions(query, controller.signal);
        setSuggestions(nextSuggestions);
        setHighlightedIndex(nextSuggestions.length > 0 ? 0 : -1);
        setHasResolvedQuery(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setHighlightedIndex(-1);
        setErrorMessage(error instanceof Error ? error.message : "Address lookup failed.");
        setHasResolvedQuery(true);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [disabled, isFocused, query]);

  const clearLookupState = () => {
    setSuggestions([]);
    setErrorMessage("");
    setIsLoading(false);
    setHighlightedIndex(-1);
    setHasResolvedQuery(false);
  };

  const handleValueChange = (nextValue) => {
    if (nextValue !== lastSelectedValueRef.current) {
      lastSelectedValueRef.current = "";
    }
    onChange(nextValue);
  };

  const handleSelect = (suggestion) => {
    lastSelectedValueRef.current = suggestion.formatted;
    clearLookupState();
    onChange(suggestion.formatted);
    onSelectSuggestion?.(suggestion);
  };

  return (
    <div className="relative">
      <Input
        {...props}
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-controls={showDropdown ? listboxId : undefined}
        aria-expanded={showDropdown}
        className={className}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onBlur={(event) => {
          setIsFocused(false);
          onBlur?.(event);
        }}
        onChange={(event) => handleValueChange(event.target.value)}
        onFocus={(event) => {
          setIsFocused(true);
          onFocus?.(event);
        }}
        onKeyDown={(event) => {
          if (!showDropdown || suggestions.length === 0) {
            if (event.key === "Escape") {
              clearLookupState();
            }
            return;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlightedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
            return;
          }

          if (event.key === "Enter" && highlightedIndex >= 0) {
            event.preventDefault();
            handleSelect(suggestions[highlightedIndex]);
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            clearLookupState();
          }
        }}
      />

      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute inset-x-0 top-[calc(100%+0.4rem)] z-30 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>Searching real addresses...</span>
            </div>
          ) : errorMessage ? (
            <div className="px-3 py-3 text-sm text-rose-700">{errorMessage}</div>
          ) : suggestions.length === 0 ? (
            <div className="px-3 py-3 text-sm text-slate-500">
              No matches yet. Keep typing or use the address exactly as entered.
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto py-1">
              {suggestions.map((suggestion, index) => {
                const isActive = index === highlightedIndex;

                return (
                  <button
                    key={suggestion.placeId || `${suggestion.formatted}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-2.5 text-left transition",
                      isActive ? "bg-slate-900 text-white" : "text-slate-900 hover:bg-slate-100"
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      handleSelect(suggestion);
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <MapPin className={cn("mt-0.5 h-4 w-4 shrink-0", isActive ? "text-slate-200" : "text-slate-400")} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{suggestion.addressLine1 || suggestion.formatted}</span>
                      {suggestion.addressLine2 ? (
                        <span className={cn("mt-0.5 block truncate text-xs", isActive ? "text-slate-300" : "text-slate-500")}>
                          {suggestion.addressLine2}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
