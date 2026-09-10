// Existing Service Board formatter, shared without changing its display rules.
export function formatStreetAndSuburb(address) {
  const parts = String(address || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return "Site not set";
  const street = parts[0];
  const suburb = (parts[1] || parts[0])
    .replace(/\b(VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\b/gi, "")
    .replace(/\b\d{4}\b/g, "").replace(/\s+/g, " ").trim();
  return suburb && suburb !== street ? `${street}, ${suburb}` : street;
}
