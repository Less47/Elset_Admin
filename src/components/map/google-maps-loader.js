import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

export const MISSING_KEY_MESSAGE = import.meta.env.DEV
  ? "Google Maps is not configured. Add VITE_GOOGLE_MAPS_API_KEY to .env.local and restart the Vite dev server."
  : "Google Maps is not configured. Set VITE_GOOGLE_MAPS_API_KEY in the build environment and rebuild the application.";
export const AUTH_ERROR_MESSAGE = "Google Maps rejected this request. Check that Maps JavaScript API and billing are enabled, and that the key permits this site's HTTP referrer. Reload after correcting the configuration.";
export const LOAD_ERROR_MESSAGE = "Google Maps could not load. Check your connection, browser blocking and Maps JavaScript API configuration, then reload.";
export const MISSING_ADDRESS_KEY_MESSAGE = import.meta.env.DEV
  ? "Google address lookup is not configured. Add VITE_GOOGLE_MAPS_API_KEY to .env.local and restart the Vite dev server. You can still enter and save an address manually."
  : "Google address lookup is not configured. You can still enter and save an address manually.";
export const PLACES_LOAD_ERROR_MESSAGE = "Google Places address lookup could not be loaded. You can still enter and save an address manually.";

// Retain the singleton during Vite hot updates too: the vendor loader warns on
// repeated setOptions calls, so reconfiguration must never receive the key again.
const state = import.meta.hot?.data.googleMapsLoader || { librariesPromise: null, authFailed: false, authListeners: new Set() };
if (import.meta.hot) import.meta.hot.data.googleMapsLoader = state;

export function subscribeToGoogleAuthFailure(listener) {
  state.authListeners.add(listener);
  if (state.authFailed) listener();
  return () => state.authListeners.delete(listener);
}

function configureGoogle() {
  if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()) {
    throw Object.assign(new Error(MISSING_KEY_MESSAGE), { code: "GOOGLE_MAPS_KEY_MISSING" });
  }
  if (!state.configured && !state.librariesPromise) {
    const previousAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      state.authFailed = true;
      state.authListeners.forEach((listener) => listener());
      previousAuthFailure?.();
    };
    // Configure exactly once: repeated loader options can otherwise log the key.
    setOptions({ key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY.trim(), v: "weekly", region: "AU", language: "en" });
    state.configured = true;
  }
  if (state.authFailed) throw new Error(AUTH_ERROR_MESSAGE);
}

export async function loadGoogleMaps() {
  configureGoogle();
  if (!state.librariesPromise) {
    state.librariesPromise = Promise.all([importLibrary("maps"), importLibrary("marker"), importLibrary("core")])
      .then(([maps, marker, core]) => ({ ...maps, ...marker, ColorScheme: core.ColorScheme }));
  }
  return state.librariesPromise;
}

export async function loadGooglePlaces() {
  configureGoogle();
  // Address entry loads Places only, without creating a map or loading markers.
  state.placesPromise ||= importLibrary("places").catch((error) => {
    state.placesPromise = null;
    throw error;
  });
  return state.placesPromise;
}
