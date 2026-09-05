import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LoaderCircle } from "lucide-react";
import {
  FilterButton,
  FilterSheetField,
  MobileFilterSheet,
  PageSearchField,
  ResponsivePageControls,
  ResultSummary,
} from "@/components/shared/ResponsivePageControls";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  buildCustomerSites,
  customerTypeOptions,
  formatCustomerType,
  formatSiteType,
  normalizeSiteAddress,
  siteTypeOptions,
  toTimestamp,
} from "@/lib/app-support";

const MELBOURNE_CENTER = [-37.8136, 144.9631];
const ALL_FILTER_VALUE = "all";
const NOT_SET_FILTER_VALUE = "not-set";
const JOB_FILTERS = [
  { value: "all", label: "All Jobs" },
  { value: "incomplete", label: "Incomplete" },
  { value: "urgent", label: "Urgent" },
  { value: "completed", label: "Completed" },
];

function createAuthorizedHeaders(contentType = null) {
  const headers = new Headers();

  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  return headers;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function createJobMarkerIcon(job, isSelected = false) {
  const isCompleted = job.status === "Completed";
  const isUrgent = job.urgency === "High" && !isCompleted;
  const color = isCompleted
    ? (isSelected ? "#047857" : "#10b981")
    : isUrgent
      ? (isSelected ? "#b91c1c" : "#ef4444")
      : (isSelected ? "#5b21b6" : "#8b5cf6");
  const size = isSelected ? 20 : 16;
  const ringColor = isCompleted
    ? (isSelected ? "#d1fae5" : "#ecfdf5")
    : isUrgent
      ? (isSelected ? "#fee2e2" : "#fff1f2")
      : (isSelected ? "#ede9fe" : "#faf5ff");
  const glowColor = isCompleted
    ? (isSelected ? "rgba(4,120,87,0.36)" : "rgba(16,185,129,0.34)")
    : isUrgent
      ? (isSelected ? "rgba(185,28,28,0.36)" : "rgba(239,68,68,0.34)")
      : (isSelected ? "rgba(91,33,182,0.38)" : "rgba(139,92,246,0.34)");
  const haloColor = isCompleted
    ? "rgba(16,185,129,0.16)"
    : isUrgent
      ? "rgba(239,68,68,0.16)"
      : "rgba(139,92,246,0.16)";

  return L.divIcon({
    className: "jobs-map-pin",
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:3px solid ${ringColor};box-shadow:0 0 0 6px ${haloColor},0 14px 30px ${glowColor};"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createJobPopupContent(job, onOpenJob) {
  const container = document.createElement("div");
  container.style.display = "grid";
  container.style.gap = "10px";
  container.style.minWidth = "190px";

  const title = document.createElement("p");
  title.textContent = job.title || `Job #${job.jobNumber || ""}`.trim() || "Job";
  title.style.margin = "0";
  title.style.fontWeight = "700";
  title.style.color = "#0f172a";
  title.style.lineHeight = "1.35";

  const meta = document.createElement("p");
  meta.textContent = [
    job.jobNumber ? `#${job.jobNumber}` : "",
    job.customerName || "",
  ].filter(Boolean).join(" - ");
  meta.style.margin = "0";
  meta.style.fontSize = "12px";
  meta.style.color = "#64748b";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Job Details";
  button.style.border = "0";
  button.style.borderRadius = "10px";
  button.style.background = "#0f172a";
  button.style.color = "#ffffff";
  button.style.cursor = "pointer";
  button.style.fontSize = "12px";
  button.style.fontWeight = "700";
  button.style.padding = "8px 10px";
  button.style.width = "100%";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenJob(job);
  });

  container.append(title, meta, button);
  return container;
}

function buildMarkerPositions(jobs) {
  const groupedByAddress = new Map();

  jobs.forEach((job) => {
    const addressKey = normalizeSiteAddress(job.jobAddress).toLowerCase();
    if (!addressKey || !job.location) return;
    const current = groupedByAddress.get(addressKey) || [];
    current.push(job.id);
    groupedByAddress.set(addressKey, current);
  });

  return jobs.map((job) => {
    if (!job.location) {
      return { ...job, displayLat: null, displayLon: null };
    }

    const addressKey = normalizeSiteAddress(job.jobAddress).toLowerCase();
    const siblingIds = groupedByAddress.get(addressKey) || [job.id];
    const siblingIndex = siblingIds.indexOf(job.id);

    if (siblingIds.length <= 1 || siblingIndex === -1) {
      return {
        ...job,
        displayLat: job.location.lat,
        displayLon: job.location.lon,
      };
    }

    const radius = 0.00028;
    const angle = (Math.PI * 2 * siblingIndex) / siblingIds.length;

    return {
      ...job,
      displayLat: job.location.lat + Math.sin(angle) * radius,
      displayLon: job.location.lon + Math.cos(angle) * radius,
    };
  });
}

export default function JobsMapManager({ customers, jobs, onOpenJob }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [search, setSearch] = useState("");
  const [jobFilter, setJobFilter] = useState(ALL_FILTER_VALUE);
  const [siteTypeFilter, setSiteTypeFilter] = useState(ALL_FILTER_VALUE);
  const [customerTypeFilter, setCustomerTypeFilter] = useState(ALL_FILTER_VALUE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mapConfig, setMapConfig] = useState(null);
  const [mapConfigError, setMapConfigError] = useState("");
  const [isLoadingMapConfig, setIsLoadingMapConfig] = useState(true);
  const [geocodeResultsByAddress, setGeocodeResultsByAddress] = useState({});
  const [geocodeError, setGeocodeError] = useState("");
  const [isLoadingGeocodes, setIsLoadingGeocodes] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const filterTriggerRef = useRef(null);

  const customerById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers]
  );

  const customerJobsById = useMemo(() => {
    const groupedJobs = new Map();

    jobs.forEach((job) => {
      const current = groupedJobs.get(job.customerId) || [];
      current.push(job);
      groupedJobs.set(job.customerId, current);
    });

    return groupedJobs;
  }, [jobs]);

  const siteTypeByCustomerAddress = useMemo(() => {
    const nextSiteTypeMap = new Map();

    customers.forEach((customer) => {
      const customerJobs = customerJobsById.get(customer.id) || [];
      buildCustomerSites(customer, customerJobs).forEach((site) => {
        const addressKey = normalizeSiteAddress(site.address).toLowerCase();
        if (!addressKey) return;
        nextSiteTypeMap.set(`${customer.id}:${addressKey}`, site.siteType || "");
      });
    });

    return nextSiteTypeMap;
  }, [customerJobsById, customers]);

  const enrichedJobs = useMemo(
    () =>
      [...jobs]
        .sort((a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt))
        .map((job) => {
          const customer = customerById.get(job.customerId) || null;
          const addressKey = normalizeSiteAddress(job.jobAddress).toLowerCase();

          return {
            ...job,
            customerType: customer?.customerType || "",
            siteType: addressKey ? siteTypeByCustomerAddress.get(`${job.customerId}:${addressKey}`) || "" : "",
          };
        }),
    [customerById, jobs, siteTypeByCustomerAddress]
  );

  const filteredJobs = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    return enrichedJobs.filter((job) => {
      const matchesQuery = query
        ? [
          job.jobNumber,
          job.customerName,
          job.title,
          job.description,
          job.jobAddress,
          formatCustomerType(job.customerType),
          formatSiteType(job.siteType),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query)
        : true;

      const matchesJobFilter = jobFilter === ALL_FILTER_VALUE
        ? true
        : jobFilter === "incomplete"
          ? job.status !== "Completed"
        : jobFilter === "urgent"
          ? job.urgency === "High"
          : jobFilter === "completed"
            ? job.status === "Completed"
            : true;

      const matchesSiteType = siteTypeFilter === ALL_FILTER_VALUE
        ? true
        : siteTypeFilter === NOT_SET_FILTER_VALUE
          ? !job.siteType
          : job.siteType === siteTypeFilter;

      const matchesCustomerType = customerTypeFilter === ALL_FILTER_VALUE
        ? true
        : customerTypeFilter === NOT_SET_FILTER_VALUE
          ? !job.customerType
          : job.customerType === customerTypeFilter;

      return matchesQuery && matchesJobFilter && matchesSiteType && matchesCustomerType;
    });
  }, [customerTypeFilter, deferredSearch, enrichedJobs, jobFilter, siteTypeFilter]);

  const uniqueJobAddresses = useMemo(
    () => [...new Set(
      enrichedJobs
        .map((job) => normalizeSiteAddress(job.jobAddress))
        .filter(Boolean)
    )],
    [enrichedJobs]
  );

  const jobsWithLocations = useMemo(() => buildMarkerPositions(
    filteredJobs.map((job) => {
      const addressKey = normalizeSiteAddress(job.jobAddress).toLowerCase();
      return {
        ...job,
        location: geocodeResultsByAddress[addressKey] ?? null,
      };
    })
  ), [filteredJobs, geocodeResultsByAddress]);

  const pinnedJobs = useMemo(
    () => jobsWithLocations.filter((job) => job.location && Number.isFinite(job.displayLat) && Number.isFinite(job.displayLon)),
    [jobsWithLocations]
  );
  const activeFilterCount = [
    jobFilter !== ALL_FILTER_VALUE,
    siteTypeFilter !== ALL_FILTER_VALUE,
    customerTypeFilter !== ALL_FILTER_VALUE,
  ].filter(Boolean).length;

  useEffect(() => {
    let cancelled = false;

    async function loadMapConfig() {
      setIsLoadingMapConfig(true);
      setMapConfigError("");

      try {
        const payload = await fetchJson("/api/map/config", {
          method: "GET",
          headers: createAuthorizedHeaders(),
        });

        if (cancelled) return;
        setMapConfig(payload.tiles || null);
      } catch (error) {
        if (cancelled) return;
        setMapConfig(null);
        setMapConfigError(error instanceof Error ? error.message : "Unable to load the map tiles.");
      } finally {
        if (!cancelled) {
          setIsLoadingMapConfig(false);
        }
      }
    }

    loadMapConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (uniqueJobAddresses.length === 0) return undefined;

    const missingAddresses = uniqueJobAddresses.filter((address) => geocodeResultsByAddress[address.toLowerCase()] === undefined);
    if (missingAddresses.length === 0) return undefined;

    const controller = new AbortController();
    let cancelled = false;

    async function geocodeAddresses() {
      setIsLoadingGeocodes(true);
      setGeocodeError("");

      try {
        const payload = await fetchJson("/api/map/geocode", {
          method: "POST",
          headers: createAuthorizedHeaders("application/json"),
          body: JSON.stringify({ addresses: missingAddresses }),
          signal: controller.signal,
        });

        if (cancelled) return;

        const nextEntries = Object.fromEntries(
          (Array.isArray(payload?.results) ? payload.results : []).map((entry) => [
            normalizeSiteAddress(entry.address).toLowerCase(),
            entry.location || null,
          ])
        );

        setGeocodeResultsByAddress((prev) => ({
          ...prev,
          ...nextEntries,
        }));
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setGeocodeError(error instanceof Error ? error.message : "Unable to geocode the saved job addresses.");
      } finally {
        if (!cancelled) {
          setIsLoadingGeocodes(false);
        }
      }
    }

    geocodeAddresses();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [geocodeResultsByAddress, uniqueJobAddresses]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !mapConfig) return undefined;

    const tileUrl = window.devicePixelRatio > 1 ? mapConfig.retinaUrl : mapConfig.url;
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
    }).setView(MELBOURNE_CENTER, 10);

    L.tileLayer(tileUrl, {
      attribution: mapConfig.attribution,
      maxZoom: mapConfig.maxZoom || 20,
    }).addTo(map);

    mapRef.current = map;
    setIsMapReady(true);

    requestAnimationFrame(() => {
      map.invalidateSize();
    });

    return () => {
      setIsMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [mapConfig]);

  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;

    if (markersLayerRef.current) {
      markersLayerRef.current.remove();
      markersLayerRef.current = null;
    }

    const nextLayer = L.layerGroup();
    const shouldShowHoverTooltips = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    pinnedJobs.forEach((job) => {
      const marker = L.marker([job.displayLat, job.displayLon], {
        icon: createJobMarkerIcon(job),
      });

      if (shouldShowHoverTooltips) {
        marker.bindTooltip(
          `${job.jobNumber ? `#${job.jobNumber} ` : ""}${job.title}`,
          {
            direction: "top",
            offset: [0, -10],
          }
        );
      }
      marker.bindPopup(createJobPopupContent(job, onOpenJob), {
        closeButton: true,
        offset: [0, -12],
      });
      marker.on("click", () => {
        const map = mapRef.current;
        if (!map) return;
        const maxZoom = Number.isFinite(map.getMaxZoom()) ? map.getMaxZoom() : 20;
        const nextZoom = Math.min(maxZoom, Math.min(map.getZoom() + 1, 14));
        marker.closeTooltip();
        map.setView([job.displayLat, job.displayLon], nextZoom, { animate: true });
        marker.openPopup();
      });
      nextLayer.addLayer(marker);
    });

    nextLayer.addTo(mapRef.current);
    markersLayerRef.current = nextLayer;
  }, [isMapReady, onOpenJob, pinnedJobs]);

  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;

    requestAnimationFrame(() => {
      mapRef.current?.invalidateSize();
    });

    if (pinnedJobs.length === 0) {
      mapRef.current.setView(MELBOURNE_CENTER, 10, { animate: true });
      return;
    }

    if (pinnedJobs.length === 1) {
      mapRef.current.setView([pinnedJobs[0].displayLat, pinnedJobs[0].displayLon], 13, { animate: true });
      return;
    }

    const bounds = L.latLngBounds(pinnedJobs.map((job) => [job.displayLat, job.displayLon]));
    mapRef.current.fitBounds(bounds, {
      padding: [36, 36],
      maxZoom: 13,
    });
  }, [isMapReady, pinnedJobs]);

  useEffect(() => {
    if (!isMapReady || !mapRef.current || !mapContainerRef.current || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        mapRef.current?.invalidateSize();
      });
    });

    observer.observe(mapContainerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [isMapReady]);

  return (
    <>
    <div className="space-y-4">
      <ResponsivePageControls
        search={(
          <PageSearchField value={search} onChange={setSearch} placeholder="Search map jobs..." label="Search map jobs" />
        )}
        controls={(
          <FilterButton ref={filterTriggerRef} activeCount={activeFilterCount} open={filtersOpen} onClick={() => setFiltersOpen(true)} />
        )}
        summary={(
          <ResultSummary>
            {filteredJobs.length} {filteredJobs.length === 1 ? "job" : "jobs"} · {pinnedJobs.length} mapped
          </ResultSummary>
        )}
      />

      <div className="floating-page-toolbar hidden px-4 py-3 xl:block">
          <div className="grid gap-2 md:grid-cols-[minmax(220px,1.35fr)_minmax(140px,0.7fr)_minmax(150px,0.75fr)_minmax(165px,0.8fr)] md:items-end">
            <Input
              className="data-toolbar-field rounded-xl"
              placeholder="Search job number, customer, title, or address..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <div className="grid gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Job Filter</p>
              <Select value={jobFilter} onValueChange={setJobFilter}>
                <SelectTrigger className="rounded-xl bg-white">
                  <SelectValue placeholder="All jobs" />
                </SelectTrigger>
                <SelectContent>
                  {JOB_FILTERS.map((filter) => (
                    <SelectItem key={filter.value} value={filter.value}>
                      {filter.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Site Type</p>
              <Select value={siteTypeFilter} onValueChange={setSiteTypeFilter}>
                <SelectTrigger className="rounded-xl bg-white">
                  <SelectValue placeholder="All site types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All site types</SelectItem>
                  <SelectItem value={NOT_SET_FILTER_VALUE}>Not set</SelectItem>
                  {siteTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Customer Type</p>
              <Select value={customerTypeFilter} onValueChange={setCustomerTypeFilter}>
                <SelectTrigger className="rounded-xl bg-white">
                  <SelectValue placeholder="All customer types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All customer types</SelectItem>
                  <SelectItem value={NOT_SET_FILTER_VALUE}>Not set</SelectItem>
                  {customerTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
      </div>

      <Card className="rounded-3xl border-slate-200 bg-white/80 shadow-sm backdrop-blur">
        <CardContent className="grid gap-3">

          {mapConfigError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {mapConfigError}
            </div>
          ) : null}

          {geocodeError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {geocodeError}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-100">
            {isLoadingMapConfig ? (
              <div className="flex h-[60vh] min-h-[420px] items-center justify-center gap-3 text-sm text-slate-500 md:h-[64vh] md:min-h-[520px] xl:h-[calc(100vh-18rem)]">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                <span>Loading map tiles...</span>
              </div>
            ) : (
              <div ref={mapContainerRef} className="h-[60vh] min-h-[420px] w-full md:h-[64vh] md:min-h-[520px] xl:h-[calc(100vh-18rem)]" />
            )}
          </div>

          {isLoadingGeocodes ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>Geocoding saved job addresses...</span>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
    <MobileFilterSheet
      open={filtersOpen}
      onOpenChange={setFiltersOpen}
      returnFocusRef={filterTriggerRef}
      activeCount={activeFilterCount}
      description="Choose which jobs and customer sites appear on the map."
      onReset={() => {
        setJobFilter(ALL_FILTER_VALUE);
        setSiteTypeFilter(ALL_FILTER_VALUE);
        setCustomerTypeFilter(ALL_FILTER_VALUE);
      }}
    >
      <FilterSheetField id="mobile-map-job-filter" label="Jobs">
        <Select value={jobFilter} onValueChange={setJobFilter}>
          <SelectTrigger id="mobile-map-job-filter" className="h-11 w-full rounded-xl bg-white"><SelectValue placeholder="All jobs" /></SelectTrigger>
          <SelectContent>
            {JOB_FILTERS.map((filter) => <SelectItem key={filter.value} value={filter.value}>{filter.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSheetField>
      <FilterSheetField id="mobile-map-site-type-filter" label="Site type">
        <Select value={siteTypeFilter} onValueChange={setSiteTypeFilter}>
          <SelectTrigger id="mobile-map-site-type-filter" className="h-11 w-full rounded-xl bg-white"><SelectValue placeholder="All site types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER_VALUE}>All site types</SelectItem>
            <SelectItem value={NOT_SET_FILTER_VALUE}>Not set</SelectItem>
            {siteTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSheetField>
      <FilterSheetField id="mobile-map-customer-type-filter" label="Customer type">
        <Select value={customerTypeFilter} onValueChange={setCustomerTypeFilter}>
          <SelectTrigger id="mobile-map-customer-type-filter" className="h-11 w-full rounded-xl bg-white"><SelectValue placeholder="All customer types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER_VALUE}>All customer types</SelectItem>
            <SelectItem value={NOT_SET_FILTER_VALUE}>Not set</SelectItem>
            {customerTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSheetField>
    </MobileFilterSheet>
    </>
  );
}
