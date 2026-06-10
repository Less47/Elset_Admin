import { useCallback, useEffect, useState } from "react";
import { SUPPLIER_MANUALS_INDEX_URL, normalizeSupplierManuals } from "@/lib/app-support";

const initialSupplierManualState = {
  status: "idle",
  manuals: [],
  error: "",
};

export function useSupplierManuals(isAuthenticated) {
  const [supplierManualState, setSupplierManualState] = useState(() => ({ ...initialSupplierManualState }));

  const resetSupplierManualState = useCallback(() => {
    setSupplierManualState({ ...initialSupplierManualState });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setSupplierManualState({ ...initialSupplierManualState });
      return undefined;
    }

    let cancelled = false;

    async function loadSupplierManuals() {
      try {
        setSupplierManualState((prev) => ({
          status: prev.manuals.length > 0 ? "loaded" : "loading",
          manuals: prev.manuals,
          error: "",
        }));

        const response = await fetch(SUPPLIER_MANUALS_INDEX_URL, { cache: "no-cache" });
        if (!response.ok) {
          throw new Error(`Supplier manuals returned ${response.status}.`);
        }

        const payload = await response.json();
        const manuals = normalizeSupplierManuals(payload);
        if (cancelled) return;

        setSupplierManualState({
          status: "loaded",
          manuals,
          error: "",
        });
      } catch (error) {
        if (cancelled) return;

        setSupplierManualState({
          status: "error",
          manuals: [],
          error: error instanceof Error ? error.message : "Unable to load supplier manuals.",
        });
      }
    }

    loadSupplierManuals();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  return {
    supplierManualState,
    resetSupplierManualState,
  };
}
