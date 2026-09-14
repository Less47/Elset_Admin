import express from "express";

// Read the existing resolver cache only. This router has no geocoder or write dependency.
export function createMapLocationsRouter({ requireAuth, requireRole, readWorkspace, getCachedLocation }) {
  const router = express.Router();
  router.get("/api/map/locations", requireAuth, requireRole(["admin", "office"]), (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const workspace = readWorkspace(req.user);
      const results = (workspace.jobs || []).map((job) => {
        const address = String(job.jobAddress || "").replace(/\s+/g, " ").trim();
        const cached = address ? getCachedLocation(address) : null;
        const valid = Number.isFinite(cached?.lat) && Number.isFinite(cached?.lon)
          && Math.abs(cached.lat) <= 90 && Math.abs(cached.lon) <= 180;
        return { jobId: job.id, location: valid ? { lat: cached.lat, lon: cached.lon } : null };
      });
      return res.json({ source: "geoapify-runtime-cache", results });
    } catch {
      return res.status(503).json({ error: "Existing map coordinates are temporarily unavailable." });
    }
  });
  return router;
}
