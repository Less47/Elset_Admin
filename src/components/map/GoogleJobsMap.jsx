import { indexCustomerSites, resolveJobSiteLocation, siteAddressMetadata } from "@/lib/site-location";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import SiteNavigationLink from "@/components/shared/SiteNavigationLink";
import { jobNavigationDestination } from "@/lib/site-navigation";
import { buildCustomerSites, formatCustomerType, formatSiteType, normalizeSiteAddress, toTimestamp } from "@/lib/app-support";
import GoogleMapFilters from "./GoogleMapFilters";
import { groupJobsByPosition, markerStacksByJob, matchesMapFilters, readSavedPosition } from "./google-map-data";
import { jobMapSymbol, statuses } from "@/lib/job-status";
import { AUTH_ERROR_MESSAGE, LOAD_ERROR_MESSAGE, MISSING_KEY_MESSAGE, loadGoogleMaps, subscribeToGoogleAuthFailure } from "./google-maps-loader";
import { createGoogleMarkerManager } from "./google-marker-manager";
import { useExistingMapLocations } from "./useExistingMapLocations";
import "./GoogleJobsMap.css";

const MELBOURNE = { lat: -37.8136, lng: 144.9631 };

export default function GoogleJobsMap({ customers, jobs, dark = false, onOpenJob, onOpenSite }) {
  const canvasRef = useRef(null);
  const statusRef = useRef(null);
  const markerManagerRef = useRef(null);
  const viewportKeyRef = useRef(null);
  const savedViewportRef = useRef(null);
  const [runtime, setRuntime] = useState(null);
  const [loadState, setLoadState] = useState({ loading: true, error: "" });
  const [filters, setFilters] = useState({ search: "", jobFilter: "all", siteTypeFilter: "all", customerTypeFilter: "all" });
  const [selectedIds, setSelectedIds] = useState([]);
  const search = useDeferredValue(filters.search);
  const datasetKey = useMemo(() => JSON.stringify([
    jobs.map((job) => [job.id, job.customerId, job.siteId || job.site_id, normalizeSiteAddress(job.jobAddress)]),
    customers.map((customer) => [customer.id, (customer.sites || []).map((site) => [site.id, site.address, siteAddressMetadata(site)])]),
  ]), [jobs, customers]);
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
    const savedSiteIndex = indexCustomerSites(customers);
    customers.forEach((customer) => {
      buildCustomerSites(customer, jobsByCustomer.get(customer.id) || []).forEach((site) => {
        siteByCustomerAddress.set(`${customer.id}:${normalizeSiteAddress(site.address).toLowerCase()}`, site);
      });
    });
    return [...jobs].sort((a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt)).map((job) => {
      const customer = customerById.get(job.customerId);
      const addressKey = normalizeSiteAddress(job.jobAddress).toLowerCase();
      const resolved = resolveJobSiteLocation(job, savedSiteIndex);
      const savedSite = resolved.site;
      const site = savedSite || siteByCustomerAddress.get(`${job.customerId}:${addressKey}`);
      const latest = locations.get(job.id);
      const customerType = customer?.customerType || "";
      const siteType = site?.siteType || "";
      const position = latest ? latest.siteId ? readSavedPosition(latest.location) : null : resolved.position;
      return { ...job, customerType, siteType,
        customerTypeLabel: formatCustomerType(customerType), siteTypeLabel: formatSiteType(siteType),
        siteKey: latest ? latest.siteId || "" : savedSite?.id || "", siteLabel: site?.label || "",
        mapSiteAddress: savedSite?.address || job.jobAddress,
        locationReason: latest ? latest.reason : resolved.reason,
        position,
        navigationDestination: jobNavigationDestination(job, savedSite || site, position),
      };
    });
  }, [customers, jobs, locations]);
  const filteredJobs = useMemo(() => enrichedJobs.filter((job) => matchesMapFilters(job, { ...filters, search }, { formatCustomerType, formatSiteType })), [enrichedJobs, filters, search]);
  const mappedJobs = useMemo(() => filteredJobs.filter((job) => job.position), [filteredJobs]);
  const stacks = useMemo(() => markerStacksByJob(mappedJobs), [mappedJobs]);
  const viewportKey = useMemo(() => JSON.stringify(groupJobsByPosition(mappedJobs).map((group) => group.position).sort((a, b) => a.lat - b.lat || a.lng - b.lng)), [mappedJobs]);
  const mappedCount = mappedJobs.length;
  const missingSiteCount = filteredJobs.filter((job) => ["site-not-found", "ambiguous-site"].includes(job.locationReason)).length;
  const selectedJobs = filteredJobs.filter((job) => selectedIds.includes(job.id));
  const selectedId = selectedJobs[0]?.id;
  const selectedStack = stacks.get(selectedId) || [];
  const hasUnknownStatus = mappedJobs.some((job) => jobMapSymbol(job.status).tone === "unknown");

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
    let manager;
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
      setLoadState({ loading: true, error: "" });
      map = new libraries.Map(container, {
        center: savedViewportRef.current?.center || MELBOURNE,
        zoom: savedViewportRef.current?.zoom ?? 10,
        // Road-shield visibility comes from the light/dark cloud styles on this ID.
        mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID?.trim() || "DEMO_MAP_ID",
        colorScheme: dark ? libraries.ColorScheme.DARK : libraries.ColorScheme.LIGHT,
        disableDefaultUI: true, zoomControl: true,
        gestureHandling: "greedy", clickableIcons: false,
      });
      container.dataset.mapScheme = dark ? "dark" : "light";
      manager = createGoogleMarkerManager({ map, AdvancedMarkerElement: libraries.AdvancedMarkerElement,
        CollisionBehavior: libraries.CollisionBehavior,
        onSelect: (job, cycling) => {
          setSelectedIds([job.id]);
          map.panTo(job.position);
          if (!cycling) map.setZoom(Math.min((map.getZoom() || 10) + 1, 14));
        },
      });
      markerManagerRef.current = manager;
      const syncMapState = () => {
        const center = map.getCenter();
        if (disposed || failed || !center) return;
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
      setRuntime({ map, dark });
    }).catch((error) => fail(error.message === MISSING_KEY_MESSAGE ? MISSING_KEY_MESSAGE : LOAD_ERROR_MESSAGE));
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      unsubscribe();
      observer?.disconnect();
      cancelAnimationFrame(resizeFrame);
      listeners.forEach((listener) => listener.remove());
      manager?.dispose();
      markerManagerRef.current = null;
      if (map) {
        const center = map.getCenter();
        if (center) savedViewportRef.current = { center: { lat: center.lat(), lng: center.lng() }, zoom: map.getZoom() };
        window.google.maps.event.clearInstanceListeners(map);
      }
      delete container.dataset.mapReady;
      container.replaceChildren();
    };
  }, [dark]);

  useEffect(() => {
    markerManagerRef.current?.sync(enrichedJobs, mappedJobs, stacks);
  }, [enrichedJobs, mappedJobs, stacks, runtime]);

  useEffect(() => { markerManagerRef.current?.setSelected(selectedId); }, [selectedId, runtime]);

  useEffect(() => {
    if (!runtime || runtime.dark !== dark || coordinates.loading || viewportKeyRef.current === viewportKey) return undefined;
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
  }, [runtime, dark, viewportKey, coordinates.loading]);

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
      data-eligible-count={mappedCount} data-site-coordinate-count={mappedCount} data-unmapped-count={filteredJobs.length - mappedCount}>
      {filteredJobs.length} {filteredJobs.length === 1 ? "job" : "jobs"} · {mappedCount} mapped · {filteredJobs.length - mappedCount} missing location
      <ul className="google-map-legend" aria-label="Job marker status legend">
        {statuses.map((status) => <li key={status}><span className="google-map-legend-dot" data-tone={jobMapSymbol(status).tone} aria-hidden="true" />{status}</li>)}
        {hasUnknownStatus && <li><span className="google-map-legend-dot" data-tone="unknown" aria-hidden="true" />Other / not set</li>}
      </ul>
      {coordinates.loading && <p className="mt-1 flex items-center gap-2"><LoaderCircle className="h-3 w-3 animate-spin" />Reading saved Site coordinates...</p>}
      {coordinates.error && <p className="mt-1" role="alert">{coordinates.error}</p>}
      {!coordinates.loading && missingSiteCount > 0 && <p className="mt-1">{missingSiteCount} without a matching saved Site.</p>}
      {!coordinates.loading && (mappedCount < filteredJobs.length || coordinates.error) && <Button size="sm" variant="ghost" className="pointer-events-auto mt-1" onClick={coordinates.refresh}><RefreshCw className="h-3 w-3" />Refresh coordinates</Button>}
    </div>
    {selectedJobs.length > 0 && !loadState.error && <aside className="google-test-details rounded-xl border border-border bg-popover text-popover-foreground shadow-xl" aria-label="Map job details">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <h2 className="text-sm font-semibold">Job details</h2>
        <Button variant="ghost" size="icon" onClick={() => setSelectedIds([])} aria-label="Close map details"><X className="h-4 w-4" /></Button>
      </div>
      {selectedStack.length > 1 && <div className="google-map-stack-actions border-b border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">Jobs share this location</p>
        <Button size="sm" variant="outline" onClick={() => markerManagerRef.current?.cycle(selectedId)}>Next job here</Button>
      </div>}
      <div className="google-test-job-list divide-y divide-border">
        {selectedJobs.map((job) => <article key={job.id} className="grid gap-2 p-3">
          <p className="text-xs text-muted-foreground">#{job.jobNumber || "—"} · {job.status || "Status not set"}</p>
          <h3 className="text-sm font-semibold">{job.title || "Job"}</h3>
          <p className="text-sm">{job.customerName || "Customer not set"}</p>
          <p className="text-xs text-muted-foreground">{[job.siteLabel, job.mapSiteAddress].filter(Boolean).join(" · ") || "Address not set"}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onOpenJob(job)}>Open Job</Button>
            {job.siteKey && onOpenSite && <Button size="sm" variant="outline" onClick={() => onOpenSite(job.customerId, job.siteKey)}>Open Site</Button>}
            <SiteNavigationLink destination={job.navigationDestination} variant="button" />
          </div>
        </article>)}
      </div>
    </aside>}
  </section>;
}
