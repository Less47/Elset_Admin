import crypto from "node:crypto";
import fs from "node:fs";

// Synthetic values, documented Intuit envelope shape; never a captured customer payload.
export const quickBooksCloudEvents = JSON.parse(fs.readFileSync(new URL("../fixtures/quickbooks-cloudevents.json", import.meta.url), "utf8"));
export const quickBooksCloudEvent = (overrides = {}) => ({ ...quickBooksCloudEvents[0], id: crypto.randomUUID(), data: {}, ...overrides });
