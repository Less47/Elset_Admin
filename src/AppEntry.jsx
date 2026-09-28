import { lazy, Suspense } from "react";
import PublicLegalPage from "./components/legal/PublicLegalPage.jsx";
import { legalDocuments } from "./lib/legal-documents.js";
import { AuthLoadingScreen } from "./components/auth/AuthLoadingScreen.jsx";

import UnsavedChangesProvider from "./components/workspace/UnsavedChangesProvider.jsx";

const App = lazy(() => import("./App.jsx"));

export default function AppEntry({ legalPath }) {
  // Only these two documents bypass the existing application/session boundary.
  // Do not load App or its workspace hooks for a public legal page.
  const legalDocument = legalDocuments[legalPath];
  if (legalDocument) return <PublicLegalPage document={legalDocument} />;

  return (
    <Suspense fallback={<AuthLoadingScreen logoSrc="/elset-logo.png" />}>
      <UnsavedChangesProvider><App /></UnsavedChangesProvider>
    </Suspense>
  );
}
