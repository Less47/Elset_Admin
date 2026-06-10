process.env.ELSET_DISABLE_STATIC = "true";
process.env.ELSET_FRONTEND_URL = process.env.ELSET_FRONTEND_URL || "http://localhost:5173";

await import("./server.js");
