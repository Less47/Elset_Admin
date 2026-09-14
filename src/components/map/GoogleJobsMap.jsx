import { resolveJobMapPosition } from "@/lib/site-location";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, X } from "lucide-react";
import { MarkerClusterer, SuperClusterAlgorithm } from "@googlemaps/markerclusterer";
import { Button } from "@/components/ui/button";
import SiteNavigationLink from "@/components/shared/SiteNavigationLink";
import { jobNavigationDestination } from "@/lib/site-navigation";
import { buildCustomerSites, formatCustomerType, formatSiteType, normalizeSiteAddress, toTimestamp } from "@/lib/app-support";
import GoogleMapFilters from "./GoogleMapFilters";
import { groupJobsByPosition, matchesMapFilters, readSavedPosition } from "./google-map-data";
import { AUTH_ERROR_MESSAGE, LOAD_ERROR_MESSAGE, MISSING_KEY_MESSAGE, loadGoogleMaps, subscribeToGoogleAuthFailure } from "./google-maps-loader";
import { createGoogleMarkerManager } from "./google-marker-manager";
import { useExistingMapLocations } from "./useExistingMapLocations";
import "./GoogleJobsMap.css";

const MELBOURNE = { lat: -37.8136, lng: 144.9631 };

export default function GoogleJobsMap({ customers, jobs, onOpenJob, onOpenSite }) {
  const canvasRef = useRef(null);
  const statusRef = useRef(null);
  const markerManagerRef = useRef(null);
  const viewportKeyRef = useRef(null);
  const [runtime, setRuntime] = useState(null);
  const [loadState, setLoadState] = useState({ loading: true, error: "" });
  const [filters, setFilters] = useState({ search: "", jobFilter: "all", siteTypeFilter: "all", customerTypeFilter: "all" });
  const [selectedIds, setSelectedIds] = useState([]);
  const search = useDeferredValue(filters.search);
  const datasetKey = useMemo(() => JSON.stringify(jobs.map((job) => [job.id, normalizeSiteAddress(job.jobAddress)]).sort()), [jobs]);
  const coordinates = useExistingMapLocations(datasetKey, Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()) && jobs.length > 0);
  const { locations } = coordinates;

  const enrichedJobs = useMemo(() => {
    const customerById = new Map(customers.map((customer) => [customer.id, customer]));
    const jobsByCustomer = new Map();
    jobs.forEach((job) => {
      if (!jobsByCustomer.has(job.customerId)) jobsByCustomer.set(job.customerId, []);
      jobsByCustomer.get(job.customerId).push(job);
    });
    const siteByCustomerAddress = new Map();
    const savedSiteByAddress = new Map();
    customers.forEach((customer) => {
      buildCustomerSites(customer, jobsByCustomer.get(customer.id) || []).forEach((site) => {
        siteByCustomerAddress.set(`${customer.id}:${normalizeSiteAddress(site.address).toLowerCase()}`, site);
      });
      customer.sites?.forEach((site) => savedSiteByAddress.set(`${customer.id}:${normalizeSiteAddress(site.address).toLowerCase()}`, site));
    });
    return [...jobs].sort((a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt)).map((job) => {
      const customer = customerById.get(job.customerId);
      const addressKey = normalizeSiteAddress(job.jobAddress).toLowerCase();
      const site = siteByCustomerAddress.get(`${job.customerId}:${addressKey}`);
      const savedSite = savedSiteByAddress.get(`${job.customerId}:${addressKey}`);
      const customerType = customer?.customerType || "";
      const siteType = site?.siteType || "";
      const position = resolveJobMapPosition(job, savedSite, locations.get(job.id));
      return { ...job, customerType, siteType,
        customerTypeLabel: formatCustomerType(customerType), siteTypeLabel: formatSiteType(siteType),
        siteKey: site?.siteProfileId || site?.id || "", siteLabel: site?.label || "",
        position,
        navigationDestination: jobNavigationDestination(job, savedSite || site, position),
      };
    });
  }, [customers, jobs, locations]);
  const filteredJobs = useMemo(() => enrichedJobs.filter((job) => matchesMapFilters(job, { ...filters, search }, { formatCustomerType, formatSiteType })), [enrichedJobs, filters, search]);
  const allGroups = useMemo(() => groupJobsByPosition(enrichedJobs), [enrichedJobs]);
  const groups = useMemo(() => groupJobsByPosition(filteredJobs), [filteredJobs]);
  const viewportKey = useMemo(() => JSON.stringify(groups.map((group) => group.position).sort((a, b) => a.lat - b.lat || a.lng - b.lng)), [groups]);
  const mappedCount = groups.reduce((count, group) => count + group.jobs.length, 0);
  const cachedCount = filteredJobs.filter((job) => readSavedPosition(locations.get(job.id))).length;
  const selectedJobs = filteredJobs.filter((job) => selectedIds.includes(job.id));
  // Cluster panels may contain several locations; coincident jobs share one action.
  const navigationJobIds = new Set(groupJobsByPosition(selectedJobs).map((group) => group.jobs[0].id));

  useEffect(() => {
    const status = statusRef.current;
    const observer = new ResizeObserver(() => {
      if (status.offsetHeight) status.parentElement.style.setProperty("--google-map-status-height", `${status.offsetHeight}px`);
    });
    observer.observe(status);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = canvasRef.current;
    let disposed = false;
    let failed = false;
    let map;
    let observer;
    let resizeFrame;
    let timeout;
    const listeners = [];
    const fail = (message) => {
      if (disposed) return;
      if (failed && message !== AUTH_ERROR_MESSAGE) return;
      failed = true;
      window.clearTimeout(timeout);
      setLoadState({ loading: false, error: message });
    };
    timeout = window.setTimeout(() => fail(LOAD_ERROR_MESSAGE), 20_000);
    const unsubscribe = subscribeToGoogleAuthFailure(() => fail(AUTH_ERROR_MESSAGE));
    loadGoogleMaps().then((libraries) => {
      if (disposed || failed) return;
      map = new libraries.Map(container, {
        center: MELBOURNE, zoom: 10, mapId: "DEMO_MAP_ID",
        disableDefaultUI: true, zoomControl: true,
        gestureHandling: "greedy", clickableIcons: false,
      });
      const syncMapState = () => {
        const center = map.getCenter();
        container.dataset.mapCenter = `${center.lat().toFixed(6)},${center.lng().toFixed(6)}`;
        container.dataset.mapZoom = String(map.getZoom());
      };
      listeners.push(map.addListener("idle", syncMapState));
      listeners.push(map.addListener("tilesloaded", () => {
        if (disposed || failed) return;
        window.clearTimeout(timeout);
        container.dataset.mapReady = "true";
        syncMapState();
        setLoadState({ loading: false, error: "" });
      }));
      listeners.push(map.addListener("click", () => setSelectedIds([])));
      observer = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          if (!container.clientWidth || !container.clientHeight) return;
          const center = map.getCenter();
          window.google.maps.event.trigger(map, "resize");
          if (center) map.setCenter(center);
        });
      });
      observer.observe(container);
      setRuntime({ map, libraries });
    }).catch((error) => fail(error.message === MISSING_KEY_MESSAGE ? MISSING_KEY_MESSAGE : LOAD_ERROR_MESSAGE));
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      unsubscribe();
      observer?.disconnect();
      cancelAnimationFrame(resizeFrame);
      listeners.forEach((listener) => listener.remove());
      if (map) window.google.maps.event.clearInstanceListeners(map);
      container.replaceChildren();
    };
  }, []);

  useEffect(() => {
    if (!runtime) return undefined;
    const { map, libraries: { AdvancedMarkerElement } } = runtime;
    const manager = createGoogleMarkerManager({ map, AdvancedMarkerElement, MarkerClusterer, SuperClusterAlgorithm,
      onSelect: (selectedJobs, position, isCluster) => {
        setSelectedIds(selectedJobs.map((job) => job.id));
        if (!isCluster) {
          map.panTo(position);
          map.setZoom(Math.min((map.getZoom() || 10) + 1, 14));
        }
      },
    });
    markerManagerRef.current = manager;
    return () => {
      manager.dispose();
      markerManagerRef.current = null;
    };
  }, [runtime]);

  useEffect(() => { markerManagerRef.current?.sync(allGroups, groups); }, [allGroups, groups, runtime]);

  useEffect(() => {
    if (!runtime || coordinates.loading || viewportKeyRef.current === viewportKey) return undefined;
    let clampListener;
    // Coalesce typing and coordinate arrival. Selection, theme, record content and
    // sidebar resizing do not change this key, so the user's viewport is retained.
    const timer = window.setTimeout(() => {
      const { map } = runtime;
      const positions = JSON.parse(viewportKey);
      viewportKeyRef.current = viewportKey;
      if (positions.length <= 1) {
        map.setCenter(positions[0] || MELBOURNE);
        map.setZoom(positions.length ? 13 : 10);
      } else {
        const bounds = new window.google.maps.LatLngBounds();
        positions.forEach((position) => bounds.extend(position));
        clampListener = map.addListener("idle", () => {
          clampListener.remove();
          if (map.getZoom() > 13) map.setZoom(13);
        });
        map.fitBounds(bounds, { top: 145, right: 48, bottom: 110, left: 48 });
      }
    }, 250);
    return () => { window.clearTimeout(timer); clampListener?.remove(); };
  }, [runtime, viewportKey, coordinates.loading]);

  return <section className="map-workspace google-map-test relative h-full min-h-0 w-full overflow-hidden bg-surface-raised" aria-label="Map workspace" data-google-map-workspace>
    <div ref={canvasRef} className="h-full w-full" aria-label="Jobs map" data-google-map-canvas />
    <GoogleMapFilters filters={filters} setFilters={setFilters} jobCount={filteredJobs.length} mappedCount={mappedCount} />
    {(loadState.loading || loadState.error) && <div className="google-test-load-state" role={loadState.error ? "alert" : "status"}>
      <div className="flex max-w-lg items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm text-card-foreground shadow-lg">
        {loadState.loading && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />}
        <p>{loadState.error || "Loading map..."}</p>
      </div>
    </div>}
    <div ref={statusRef} className="google-test-status rounded-xl border border-border bg-card/95 px-3 py-2 text-xs text-card-foreground shadow-sm" role="status"
      data-eligible-count={mappedCount} data-geoapify-cache-count={cachedCount} data-unmapped-count={filteredJobs.length - mappedCount}>
      {filteredJobs.length} {filteredJobs.length === 1 ? "job" : "jobs"} · {mappedCount} mapped
      {coordinates.loading && <p className="mt-1 flex items-center gap-2"><LoaderCircle className="h-3 w-3 animate-spin" />Reading existing map coordinates...</p>}
      {coordinates.error && <p className="mt-1" role="alert">{coordinates.error}</p>}
      {!coordinates.loading && mappedCount < filteredJobs.length && <p className="mt-1">{filteredJobs.length - mappedCount} without coordinates.</p>}
      {!coordinates.loading && (mappedCount < filteredJobs.length || coordinates.error) && <Button size="sm" variant="ghost" className="pointer-events-auto mt-1" onClick={coordinates.refresh}><RefreshCw className="h-3 w-3" />Refresh coordinates</Button>}
    </div>
    {selectedJobs.length > 0 && !loadState.error && <aside className="google-test-details rounded-xl border border-border bg-popover text-popover-foreground shadow-xl" aria-label="Map job details">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <h2 className="text-sm font-semibold">{selectedJobs.length === 1 ? "Job details" : `${selectedJobs.length} jobs at this location or nearby`}</h2>
        <Button variant="ghost" size="icon" onClick={() => setSelectedIds([])} aria-label="Close map details"><X className="h-4 w-4" /></Button>
      </div>
      <div className="google-test-job-list divide-y divide-border">
        {selectedJobs.map((job) => <article key={job.id} className="grid gap-2 p-3">
          <p className="text-xs text-muted-foreground">#{job.jobNumber || "—"} · {job.status || "Status not set"}</p>
          <h3 className="text-sm font-semibold">{job.title || "Job"}</h3>
          <p className="text-sm">{job.customerName || "Customer not set"}</p>
          <p className="text-xs text-muted-foreground">{[job.siteLabel, job.jobAddress].filter(Boolean).join(" · ") || "Address not set"}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onOpenJob(job)}>Open Job</Button>
            {job.siteKey && onOpenSite && <Button size="sm" variant="outline" onClick={() => onOpenSite(job.customerId, job.siteKey)}>Open Site</Button>}
            {navigationJobIds.has(job.id) && <SiteNavigationLink destination={job.navigationDestination} variant="button" />}
          </div>
        </article>)}
      </div>
    </aside>}
  </section>;
}
