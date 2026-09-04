import { useCallback, useEffect, useRef, useState } from "react";

const WORKSPACE_HISTORY_KEY = "elsetWorkspace";

function parseWorkspacePath(pathname, state = null) {
  if (pathname === "/jobs/new") {
    return {
      type: "create-job",
      path: "/jobs/new",
      sourceSection: state?.sourceSection || "service-board",
      sourceScrollY: Number(state?.sourceScrollY || 0),
    };
  }

  const jobMatch = pathname.match(/^\/jobs\/([^/]+)\/?$/);
  if (jobMatch) {
    return {
      type: "job-details",
      path: pathname,
      jobId: decodeURIComponent(jobMatch[1]),
      sourceSection: state?.sourceSection || "service-board",
      sourceScrollY: Number(state?.sourceScrollY || 0),
    };
  }

  return { type: "section", path: pathname || "/" };
}

function getWorkspaceState() {
  return window.history.state?.[WORKSPACE_HISTORY_KEY] || null;
}

export function useWorkspaceNavigation({ activeSection }) {
  const [route, setRoute] = useState(() => parseWorkspacePath(window.location.pathname, getWorkspaceState()));
  const [discardPromptOpen, setDiscardPromptOpen] = useState(false);
  const routeRef = useRef(route);
  const blockerRef = useRef(null);
  const pendingNavigationRef = useRef(null);
  const bypassNextPopRef = useRef(false);
  const pendingScrollRestoreRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

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

  const navigateTo = useCallback((nextRoute, { replace = false, force = false } = {}) => {
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
        },
      };

      if (replace) {
        window.history.replaceState(state, "", nextRoute.path);
      } else {
        window.history.pushState(state, "", nextRoute.path);
      }

      const resolvedRoute = {
        ...nextRoute,
        sourceSection,
        sourceScrollY,
      };
      routeRef.current = resolvedRoute;
      setRoute(resolvedRoute);
      window.scrollTo({ top: 0, behavior: "auto" });
    }, { force });
  }, [activeSection, runOrBlock]);

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

      window.history.replaceState(null, "", "/");
      const nextRoute = { type: "section", path: "/" };
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
    const nextRoute = { type: "section", path: "/" };
    routeRef.current = nextRoute;
    setRoute(nextRoute);
  }, []);

  useEffect(() => {
    const handlePopState = (event) => {
      const currentRoute = routeRef.current;
      const nextHistoryState = event.state?.[WORKSPACE_HISTORY_KEY] || null;
      const nextRoute = parseWorkspacePath(window.location.pathname, nextHistoryState);

      if (bypassNextPopRef.current) {
        bypassNextPopRef.current = false;
      } else if (currentRoute.type !== "section" && blockerRef.current?.()) {
        window.history.pushState({
          [WORKSPACE_HISTORY_KEY]: {
            owned: true,
            sourceSection: currentRoute.sourceSection,
            sourceScrollY: currentRoute.sourceScrollY,
          },
        }, "", currentRoute.path);
        pendingNavigationRef.current = () => {
          bypassNextPopRef.current = true;
          window.history.back();
        };
        setDiscardPromptOpen(true);
        return;
      }

      routeRef.current = nextRoute;
      setRoute(nextRoute);
      if (nextRoute.type === "section") {
        restoreSourceScroll(currentRoute.sourceScrollY);
      } else {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [restoreSourceScroll]);

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
    registerBlocker,
    resetToRoot,
    route,
  };
}
