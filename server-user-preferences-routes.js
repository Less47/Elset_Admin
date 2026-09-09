import express from "express";
import { openUserPreferencesDb, getUserUiPreferences, patchUserUiPreferences, readLegacyAppearance } from "./server-user-ui-preferences.js";
import { UserUiPreferenceError } from "./src/lib/user-ui-preferences.js";

export function createUserPreferencesRouter({ requireAuth, env = process.env } = {}) {
  if (typeof requireAuth !== "function") throw new Error("User preferences require session authentication.");
  const initialized = openUserPreferencesDb({ env, migrate: true });
  initialized.close();
  const router = express.Router();
  function handle(write) {
    return (req, res) => {
      let db;
      res.set("Cache-Control", "private, no-store");
      try {
        if (!req.user?.id) throw new UserUiPreferenceError("Authentication required.", 401);
        if (Object.keys(req.query).length) throw new UserUiPreferenceError("Preference queries do not accept user IDs or other parameters.");
        db = openUserPreferencesDb({ env });
        const fallback = () => readLegacyAppearance(env);
        const preferences = write
          ? patchUserUiPreferences(db, req.user.id, req.body, fallback)
          : getUserUiPreferences(db, req.user.id, fallback);
        return res.json({ ok: true, preferences });
      } catch (error) {
        return res.status(error instanceof UserUiPreferenceError ? error.statusCode : 500)
          .json({ error: error instanceof UserUiPreferenceError ? error.message : "Unable to load or save personal preferences." });
      } finally { db?.close(); }
    };
  }
  router.get("/api/user-preferences", requireAuth, handle(false));
  router.patch("/api/user-preferences", requireAuth, handle(true));
  return router;
}
