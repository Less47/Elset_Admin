import { useCallback, useEffect, useRef, useState } from "react";

const WORKSPACE_HISTORY_KEY = "elsetWorkspace";

export function parseWorkspacePath(pathname, state = null) {
  const context = {
    sourceSection: state?.sourceSection || "service-board",
    sourceScrollY: Number(state?.sourceScrollY || 0),
    returnPath: state?.returnPath || null,
    historyIndex: Number(state?.historyIndex || 0),
  };
  const documentMatch = pathname.match(/^\/jobs\/([^/]+)\/(quote|invoice)\/?$/);
  if (documentMatch) {
    return {
      ...context,
      type: "document",
      path: pathname,
      jobId: decodeURIComponent(documentMatch[1]),
      documentType: documentMatch[2],
    };
  }
  if (pathname === "/jobs/new") {
    return {
      ...context,
      type: "create-job",
      path: "/jobs/new",
      sourceSection: state?.sourceSection || "service-board",
      sourceScrollY: Number(state?.sourceScrollY || 0),
    };
  }

  const jobMatch = pathname.match(/^\/jobs\/([^/]+)\/?$/);
  if (jobMatch) {
    return {
      ...context,
      type: "job-details",
      path: pathname,
      jobId: decodeURIComponent(jobMatch[1]),
      sourceSection: state?.sourceSection || "service-board",
      sourceScrollY: Number(state?.sourceScrollY || 0),
    };
  }

  return { ...context, type: "section", path: pathname || "/", section: state?.section };
}

function getWorkspaceState() {
  return window.history.state?.[WORKSPACE_HISTORY_KEY] || null;
}

export function useWorkspaceNavigation({ activeSection, onSectionChange }) {
  const [route, setRoute] = useState(() => parseWorkspacePath(window.location.pathname, getWorkspaceState()));
  const [discardPromptOpen, setDiscardPromptOpen] = useState(false);
  const routeRef = useRef(route);
  const blockerRef = useRef(null);
  const pendingNavigationRef = useRef(null);
  const bypassNextPopRef = useRef(false);
  const restoringBlockedPopRef = useRef(false);
  const pendingScrollRestoreRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    const current = getWorkspaceState();
    window.history.replaceState({ ...window.history.state, [WORKSPACE_HISTORY_KEY]: {
      ...current,
      historyIndex: routeRef.current.historyIndex || 0,
      ...(routeRef.current.type === "section" ? { section: activeSection } : {}),
    } }, "", window.location.href);
  }, [activeSection]);

  const restoreSourceScroll = useCallback((scrollY) => {
    pendingScrollRestoreRef.current = Number(scrollY || 0);
    window.requestAnimationFrame(() => {
      if (pendingScrollRestoreRef.current === null) return;
      window.scrollTo({ top: pendingScrollRestoreRef.current, behavior: "auto" });
      pendingScrollRestoreRef.current = null;
      if (returnFocusRef.current?.isConnected) {
        returnFocusRef.current.focus({ preventScroll: true });
      }
    });
  }, []);

  const runOrBlock = useCallback((navigation, { force = false } = {}) => {
    if (!force && blockerRef.current?.()) {
      pendingNavigationRef.current = navigation;
      setDiscardPromptOpen(true);
      return false;
    }

    navigation();
    return true;
  }, []);

  const registerBlocker = useCallback((blocker) => {
    blockerRef.current = typeof blocker === "function" ? blocker : null;
    return () => {
      if (blockerRef.current === blocker) blockerRef.current = null;
    };
  }, []);

  const navigateTo = useCallback((nextRoute, { replace = false, force = false, onNavigated } = {}) => {
    return runOrBlock(() => {
      const currentRoute = routeRef.current;
      const sourceSection = currentRoute.type === "section"
        ? activeSection
        : currentRoute.sourceSection;
      const sourceScrollY = currentRoute.type === "section"
        ? window.scrollY
        : currentRoute.sourceScrollY;
      if (currentRoute.type === "section" && document.activeElement instanceof HTMLElement) {
        returnFocusRef.current = document.activeElement;
      }
      const state = {
        [WORKSPACE_HISTORY_KEY]: {
          owned: true,
          sourceSection,
          sourceScrollY,
          returnPath: nextRoute.type === "document"
            ? (currentRoute.type === "document" ? currentRoute.returnPath : currentRoute.path)
            : null,
          historyIndex: currentRoute.historyIndex + (replace ? 0 : 1),
          ...(nextRoute.type === "section" ? { section: nextRoute.section } : {}),
        },
      };

      if (replace) {
        window.history.replaceState(state, "", nextRoute.path);
      } else {
        window.history.pushState(state, "", nextRoute.path);
      }

      const resolvedRoute = {
        ...nextRoute,
        ...state[WORKSPACE_HISTORY_KEY],
      };
      routeRef.current = resolvedRoute;
      setRoute(resolvedRoute);
      if (nextRoute.type === "section") onSectionChange?.(nextRoute.section);
      onNavigated?.();
      window.scrollTo({ top: 0, behavior: "auto" });
    }, { force });
  }, [activeSection, runOrBlock, onSectionChange]);

  const navigateToDocument = useCallback((job, type) => {
    if (!job?.id || !["quote", "invoice"].includes(type)) return false;
    return navigateTo({ type: "document", jobId: job.id, documentType: type, path: `/jobs/${encodeURIComponent(job.id)}/${type}` });
  }, [navigateTo]);

  const navigateToSection = useCallback((section, onNavigated) => {
    return navigateTo({ type: "section", path: "/", section }, { onNavigated });
  }, [navigateTo]);

  const navigateToCreateJob = useCallback((options = {}) => (
    navigateTo({ type: "create-job", path: "/jobs/new" }, options)
  ), [navigateTo]);

  const navigateToJob = useCallback((job, options = {}) => {
    if (!job?.id) return false;
    if (routeRef.current.type === "job-details" && routeRef.current.jobId === job.id) return true;
    return navigateTo({
      type: "job-details",
      path: `/jobs/${encodeURIComponent(job.id)}`,
      jobId: job.id,
    }, {
      ...options,
      replace: options.replace ?? routeRef.current.type === "job-details",
    });
  }, [navigateTo]);

  const closeWorkspace = useCallback(({ force = false, onClosed = null } = {}) => {
    const currentRoute = routeRef.current;
    if (currentRoute.type === "section") {
      onClosed?.();
      return true;
    }

    return runOrBlock(() => {
      onClosed?.();
      if (getWorkspaceState()?.owned) {
        bypassNextPopRef.current = true;
        window.history.back();
        return;
      }

      const path = currentRoute.type === "document" ? `/jobs/${encodeURIComponent(currentRoute.jobId)}` : "/";
      const state = { sourceSection: currentRoute.sourceSection, historyIndex: currentRoute.historyIndex };
      window.history.replaceState({ [WORKSPACE_HISTORY_KEY]: state }, "", path);
      const nextRoute = parseWorkspacePath(path, state);
      routeRef.current = nextRoute;
      setRoute(nextRoute);
      restoreSourceScroll(currentRoute.sourceScrollY);
    }, { force });
  }, [restoreSourceScroll, runOrBlock]);

  const resetToRoot = useCallback(() => {
    blockerRef.current = null;
    pendingNavigationRef.current = null;
    setDiscardPromptOpen(false);
    window.history.replaceState(null, "", "/");
    const nextRoute = parseWorkspacePath("/");
    routeRef.current = nextRoute;
    setRoute(nextRoute);
  }, []);

  useEffect(() => {
    const handlePopState = (event) => {
      const currentRoute = routeRef.current;
      const nextHistoryState = event.state?.[WORKSPACE_HISTORY_KEY] || null;
      const nextRoute = parseWorkspacePath(window.location.pathname, nextHistoryState);

      if (restoringBlockedPopRef.current) {
        restoringBlockedPopRef.current = false;
        return;
      }

      if (bypassNextPopRef.current) {
        bypassNextPopRef.current = false;
      } else if (currentRoute.type !== "section" && blockerRef.current?.()) {
        // Restore the original entry without pushing over the Forward stack.
        const distance = currentRoute.historyIndex - nextRoute.historyIndex || 1;
        restoringBlockedPopRef.current = true;
        window.history.go(distance);
        pendingNavigationRef.current = () => {
          bypassNextPopRef.current = true;
          window.history.go(-distance);
        };
        setDiscardPromptOpen(true);
        return;
      }

      routeRef.current = nextRoute;
      setRoute(nextRoute);
      if (nextRoute.type === "section") {
        onSectionChange?.(nextRoute.section || currentRoute.sourceSection);
        restoreSourceScroll(currentRoute.sourceScrollY);
      } else {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [restoreSourceScroll, onSectionChange]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!blockerRef.current?.()) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const keepEditing = useCallback(() => {
    pendingNavigationRef.current = null;
    setDiscardPromptOpen(false);
  }, []);

  const discardAndContinue = useCallback(() => {
    const navigation = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    setDiscardPromptOpen(false);
    navigation?.();
  }, []);

  return {
    closeWorkspace,
    discardAndContinue,
    discardPromptOpen,
    keepEditing,
    navigateToCreateJob,
    navigateToJob,
    navigateToDocument,
    navigateToSection,
    registerBlocker,
    requestNavigation: runOrBlock,
    resetToRoot,
    route,
  };
}
