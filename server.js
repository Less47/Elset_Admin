import { ensureAuthReady } from "./server-auth.js";
import { createServerApp } from "./server-app.js";
import { assertProductionWorkspaceStorageReady } from "./server-workspace-storage.js";

const port = Number(process.env.ELSET_API_PORT || process.env.PORT || 3101);
const frontendUrl = String(process.env.ELSET_FRONTEND_URL || "").trim();
await ensureAuthReady();
assertProductionWorkspaceStorageReady();
const app = createServerApp();

app.listen(port, () => {
  console.log(`Elset quote API listening on http://localhost:${port}`);
  if (frontendUrl) {
    console.log(`Open the app at ${frontendUrl}`);
  }
});
