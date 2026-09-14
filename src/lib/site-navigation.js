import { readSavedPosition, resolveJobMapPosition } from "./site-location.js";

const clean = (value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

export function isApplePlatform(device = globalThis.navigator) {
  // iPadOS may identify as MacIntel with a desktop Macintosh user agent.
  // Macs and those iPads deliberately share the Apple Maps preference.
  return /iPhone|iPad|iPod|Mac/i.test(`${device?.userAgent || ""} ${device?.platform || ""} ${device?.userAgentData?.platform || ""}`);
}

export function jobNavigationDestination(job, site, position = resolveJobMapPosition(job, site)) {
  return {
    ...site,
    address: clean(site?.address) || clean(job?.jobAddress),
    latitude: position?.lat ?? null,
    longitude: position?.lng ?? null,
  };
}

export function getNavigationLinks(destination, device = globalThis.navigator) {
  const position = readSavedPosition(destination);
  const street = clean(destination?.streetAddress) || clean(destination?.addressLine1);
  const locality = clean(destination?.suburb) || clean(destination?.locality) || clean(destination?.city);
  const region = [locality, clean(destination?.state), clean(destination?.postcode)].filter(Boolean).join(" ");
  // A region alone is not a Site address; retain the complete formatted fallback.
  const structuredAddress = street ? [street, region].filter(Boolean).join(", ") : "";
  const address = structuredAddress || clean(destination?.address);
  const target = position ? `${position.lat},${position.lng}` : address;
  if (!target) return null;

  // Only fixed HTTPS origins are allowed. Site text is encoded as parameter data,
  // never interpreted as a URL. Labels are for the UI, not provider search terms.
  const google = new URL("https://www.google.com/maps/dir/");
  google.search = new URLSearchParams({ api: "1", destination: target, dir_action: "navigate" }).toString();
  const apple = new URL("https://maps.apple.com/");
  apple.search = new URLSearchParams({ daddr: target }).toString();
  const prefersApple = isApplePlatform(device);
  return {
    href: prefersApple ? apple.href : google.href,
    fallbackHref: prefersApple ? google.href : null,
    provider: prefersApple ? "Apple Maps" : "Google Maps",
    label: clean(destination?.address) || structuredAddress || clean(destination?.label) || target,
  };
}
