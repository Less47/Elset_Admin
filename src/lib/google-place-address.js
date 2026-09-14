const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const stateCodes = { Victoria: "VIC", "New South Wales": "NSW", Queensland: "QLD", "South Australia": "SA", "Western Australia": "WA", Tasmania: "TAS", "Northern Territory": "NT", "Australian Capital Territory": "ACT" };

// Parse Google's typed components, never split a formatted address into a suburb.
export function googlePlaceAddress(place) {
  const components = place.addressComponents || [];
  const component = (type, short = false) => {
    const entry = components.find((value) => value.types?.includes(type));
    return clean(short ? entry?.shortText || entry?.longText : entry?.longText || entry?.shortText);
  };
  if (component("country", true).toUpperCase() !== "AU") throw new Error("Choose an Australian address or enter it manually.");
  const street = [component("street_number"), component("route")].filter(Boolean).join(" ");
  const unit = component("subpremise");
  const streetAddress = unit && street ? `Unit ${unit}/${street}` : street;
  const suburb = component("locality") || component("postal_town") || component("sublocality_level_1") || component("sublocality");
  const rawState = component("administrative_area_level_1", true);
  const state = stateCodes[rawState] || rawState.toUpperCase();
  const postcode = component("postal_code");
  const latitude = typeof place.location?.lat === "function" ? place.location.lat() : place.location?.lat;
  const longitude = typeof place.location?.lng === "function" ? place.location.lng() : place.location?.lng;
  if (!streetAddress || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error("This result has no complete street location. Enter the address manually or choose another result.");
  }
  const locality = [suburb, state, postcode].filter(Boolean).join(" ");
  return { address: [streetAddress, locality].filter(Boolean).join(", "), streetAddress, suburb, state, postcode, latitude, longitude };
}
