import { lazy, Suspense } from "react";
import PublicLegalPage from "./components/legal/PublicLegalPage.jsx";
import { legalDocuments } from "./lib/legal-documents.js";
import { AuthLoadingScreen } from "./components/auth/AuthLoadingScreen.jsx";

const App = lazy(() => import("./App.jsx"));

export default function AppEntry() {
  // Only these two documents bypass the existing application/session boundary.
  // Do not load App or its workspace hooks for a public legal page.
  const legalDocument = legalDocuments[window.location.pathname.replace(/\/$/, "")];
  if (legalDocument) return <PublicLegalPage document={legalDocument} />;

  return (
    <Suspense fallback={<AuthLoadingScreen logoSrc="/elset-logo.png" />}>
      <App />
    </Suspense>
  );
}
