import express from "express";
import { indexCustomerSites, resolveJobSiteLocation, summarizeSiteLocations } from "./src/lib/site-location.js";

// Saved Sites survive restarts. This router has no geocoder or write dependency.
export function createMapLocationsRouter({ requireAuth, requireRole, readWorkspace }) {
  const router = express.Router();
  router.get("/api/map/locations", requireAuth, requireRole(["admin", "office"]), (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const workspace = readWorkspace(req.user);
      const index = indexCustomerSites(workspace.customers);
      const results = (workspace.jobs || []).map((job) => {
        const { site, position, reason } = resolveJobSiteLocation(job, index);
        return { jobId: job.id, siteId: site?.id || null, location: position, reason };
      });
      return res.json({ source: "saved-site-coordinates", results, summary: summarizeSiteLocations(workspace.customers, workspace.jobs) });
    } catch {
      return res.status(503).json({ error: "Saved Site coordinates are temporarily unavailable." });
    }
  });
  return router;
}
