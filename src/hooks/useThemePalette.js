import { buildSemanticTheme } from "@/lib/theme-tokens";
import { useLayoutEffect, useMemo } from "react";
import {
  APP_TEXT_DARK,
  APP_TEXT_LIGHT,
  getContrastTextColor,
  hexToRgba,
  normalizeThemeSettings,
} from "@/lib/app-support";

export function useThemePalette(settings, sidebarCollapsed = false) {
  const themeSettings = useMemo(() => normalizeThemeSettings(settings), [settings]);

  const themePalette = useMemo(() => {
    const sidebarSurfaceText = getContrastTextColor(themeSettings.sidebarSurface);
    const sidebarSurfaceTone = sidebarSurfaceText === APP_TEXT_LIGHT ? APP_TEXT_LIGHT : APP_TEXT_DARK;
    const heroText = getContrastTextColor(themeSettings.heroSurface);
    const actionText = getContrastTextColor(themeSettings.actionColor);
    const sidebarActiveText = getContrastTextColor(themeSettings.sidebarActive);
    const dialogText = getContrastTextColor(themeSettings.dialogSurface);
    const borderColor = themeSettings.borderColor;
    const dialogBorder = borderColor;
    const semantic = buildSemanticTheme(themeSettings);
    const dialogSurfaceGradient = semantic.vars['--dialog-surface-gradient'];
    const dialogMutedSurface = semantic.vars['--dialog-muted-surface'];

    return {
      dark: semantic.dark,
      roundedEdges: themeSettings.roundedEdges,
      rootStyle: {
        backgroundImage: semantic.vars["--page-gradient"],
        color: semantic.vars["--foreground"],
        colorScheme: semantic.dark ? "dark" : "light",
        ...semantic.vars,
        "--sidebar-width": sidebarCollapsed ? "68px" : "248px",
        "--sidebar-offset": sidebarCollapsed ? "92px" : "272px",
        "--section-gap": "1rem",
        "--content-padding-x-mobile": "0.75rem",
        "--content-padding-y-mobile": "0.75rem",
        "--content-padding-x-sm": "1rem",
        "--content-padding-y-sm": "1rem",
        "--content-padding-x-lg": "1.25rem",
        "--content-padding-y-lg": "1.25rem",
      },
      sidebarShell: {
        backgroundColor: hexToRgba(themeSettings.sidebarSurface, 0.94),
        borderColor,
        color: sidebarSurfaceText,
      },
      sidebarInactiveButton: {
        backgroundColor: hexToRgba(sidebarSurfaceTone, sidebarSurfaceText === APP_TEXT_LIGHT ? 0.08 : 0.04),
        borderColor,
        color: sidebarSurfaceText,
      },
      sidebarInactiveIcon: {
        backgroundColor: hexToRgba(sidebarSurfaceTone, sidebarSurfaceText === APP_TEXT_LIGHT ? 0.1 : 0.06),
        color: sidebarSurfaceText,
      },
      sidebarInactiveMuted: semantic.vars['--sidebar-muted'],
      sidebarActiveButton: {
        backgroundColor: themeSettings.sidebarActive,
        borderColor,
        color: sidebarActiveText,
        boxShadow: `0 18px 34px -22px ${hexToRgba(themeSettings.sidebarActive, 0.6)}`,
      },
      sidebarActiveIcon: {
        backgroundColor: hexToRgba(
          sidebarActiveText === APP_TEXT_LIGHT ? APP_TEXT_LIGHT : APP_TEXT_DARK,
          sidebarActiveText === APP_TEXT_LIGHT ? 0.12 : 0.08
        ),
        color: sidebarActiveText,
      },
      sidebarActiveMuted: semantic.vars['--sidebar-primary-muted'],
      heroCard: {
        backgroundColor: themeSettings.heroSurface,
        borderColor,
        color: heroText,
      },
      primaryButton: {
        backgroundColor: themeSettings.actionColor,
        borderColor,
        color: actionText,
      },
      primaryButtonHover: semantic.vars["--primary-hover"],
      borderColor,
      dialogSurface: themeSettings.dialogSurface,
      dialogSurfaceGradient,
      dialogText,
      dialogBorder,
      dialogMutedSurface,
    };
  }, [themeSettings, sidebarCollapsed]);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return undefined;

    const root = document.documentElement;

    const variables = Object.entries(themePalette.rootStyle).filter(([key]) => key.startsWith('--'));
    for (const [key, value] of variables) root.style.setProperty(key, value);
    root.classList.toggle('dark', themePalette.dark);
    root.dataset.themeMode = themePalette.dark ? 'dark' : 'light';
    root.dataset.roundedEdges = String(themePalette.roundedEdges);
    root.style.colorScheme = themePalette.dark ? 'dark' : 'light';
    return () => {
      for (const [key] of variables) root.style.removeProperty(key);
      root.classList.remove('dark');
      delete root.dataset.themeMode;
      delete root.dataset.roundedEdges;
      root.style.removeProperty('color-scheme');
    };
  }, [themePalette]);


  return { themeSettings, themePalette };
}
