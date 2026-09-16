// Contract stub for repeatable map lifecycle tests without network credentials.
// Live-provider tests separately exercise Google's rendering and interactions.
export async function installGoogleMapsStub(page) {
  await page.addInitScript(() => {
    const audit = window.mapAudit = { maps: [], markers: [], libraries: [] };
    const emit = (map, event) => map.listeners.get(event)?.forEach((callback) => callback());
    class GoogleMap {
      constructor(element, options) {
        this.element = element;
        this.options = options;
        this.center = options.center;
        this.zoom = options.zoom;
        this.listeners = new Map();
        element.style.background = options.colorScheme === "DARK" ? "#1d2531" : "#e7ece8";
        audit.maps.push(this);
        setTimeout(() => emit(this, "tilesloaded"), 30);
      }
      addListener(event, callback) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event).add(callback);
        return { remove: () => this.listeners.get(event)?.delete(callback) };
      }
      getCenter() { const c = this.center; return { lat: () => typeof c.lat === "function" ? c.lat() : c.lat, lng: () => typeof c.lng === "function" ? c.lng() : c.lng }; }
      getZoom() { return this.zoom; }
      setCenter(center) { this.center = center; queueMicrotask(() => emit(this, "idle")); }
      panTo(center) { this.setCenter(center); }
      setZoom(zoom) { this.zoom = zoom; queueMicrotask(() => emit(this, "idle")); }
      get(key) { return this.options[key]; }
      fitBounds(bounds) { this.setCenter(bounds.positions[0]); this.setZoom(13); }
    }
    class AdvancedMarkerElement extends HTMLElement {
      constructor(options) {
        super(); Object.assign(this, options); audit.markers.push(this);
        this.style.cssText = "position:absolute;left:55%;top:40%";
        this.setAttribute("role", "button"); this.tabIndex = 0;
        this.addEventListener("click", () => this.dispatchEvent(new Event("gmp-click")));
        this.addEventListener("keydown", (event) => { if (event.key === "Enter") this.click(); });
      }
      set map(value) { this._map = value; if (value) value.element.append(this); else this.remove(); }
      get map() { return this._map; }
      set zIndex(value) { this.style.zIndex = value; }
      get zIndex() { return Number(this.style.zIndex); }
    }
    customElements.define("gmp-advanced-marker", AdvancedMarkerElement);
    class LatLngBounds { constructor() { this.positions = []; } extend(position) { this.positions.push(position); } }
    const event = { trigger: emit, clearInstanceListeners(map) { map.listeners.clear(); map.disposed = true; } };
    const libraries = {
      maps: { Map: GoogleMap }, marker: { AdvancedMarkerElement, CollisionBehavior: { REQUIRED: "REQUIRED" } },
      core: { ColorScheme: { DARK: "DARK", LIGHT: "LIGHT" } },
    };
    window.google = { maps: { LatLngBounds, event, importLibrary: async (name) => { audit.libraries.push(name); return libraries[name]; } } };
  });
}
