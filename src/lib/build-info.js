/* global __ELSET_BUILD__ */

// Vite embeds this public allowlist once; no runtime environment or network lookup.
export const buildInfo = Object.freeze(typeof __ELSET_BUILD__ === "undefined"
  ? { version: "", commit: "local", sha: "", buildTime: "" }
  : __ELSET_BUILD__);

export function formatBuildTime(value, { locale, timeZone, compact = false } = {}) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return {
    date: new Intl.DateTimeFormat(locale, compact
      ? { day: "2-digit", month: "2-digit", year: "2-digit", timeZone }
      : { day: "numeric", month: "short", year: "numeric", timeZone }).format(date),
    time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(date),
  };
}
