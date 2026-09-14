import Database from "better-sqlite3";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditSiteLocations, backfillSiteCoordinates } from "../server-site-location-tools.js";

export async function siteLocationsCli(args = process.argv.slice(2), { env = process.env, output = console.log } = {}) {
  const mode = args.shift();
  if (!["audit", "backfill"].includes(mode)) throw new Error("Usage: node scripts/site-locations.mjs audit|backfill --db <workspace.db> [--apply] [--limit 25] [--retry-failed]");
  let dbPath = "", apply = false, limit = 25, retryFailed = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db") dbPath = args[++i] || "";
    else if (args[i] === "--limit") limit = Number(args[++i]);
    else if (args[i] === "--apply") apply = true;
    else if (args[i] === "--retry-failed") retryFailed = true;
    else throw new Error("Unknown Site location command option.");
  }
  if (!dbPath || dbPath === ":memory:") throw new Error("An explicit existing workspace database path is required via --db.");
  if (mode === "audit" && apply) throw new Error("Audit is read-only; --apply is only supported by backfill.");
  if (apply && !env.GOOGLE_GEOCODING_API_KEY?.trim()) throw new Error("GOOGLE_GEOCODING_API_KEY is required for an applied backfill. The browser Maps key is not used.");
  const db = new Database(path.resolve(dbPath), { readonly: !apply, fileMustExist: true, timeout: 5000 });
  try {
    if (!apply) db.pragma("query_only = ON");
    const result = mode === "audit" ? auditSiteLocations(db) : await backfillSiteCoordinates(db, {
      apply, limit, retryFailed, apiKey: env.GOOGLE_GEOCODING_API_KEY,
      onProgress: (progress) => output(JSON.stringify({ event: "progress", ...progress })),
    });
    output(JSON.stringify(result, null, 2));
    return result.failed || result.stopped ? 1 : 0;
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await siteLocationsCli(); }
  catch {
    // Do not print library errors: SQL/provider messages can contain record data.
    console.error("Site location command failed. Use audit|backfill --db <existing workspace.db>. Backfill defaults to preview; --apply needs GOOGLE_GEOCODING_API_KEY and a valid --limit (1-1000).");
    process.exitCode = 1;
  }
}
